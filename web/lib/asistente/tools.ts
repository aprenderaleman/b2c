import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import {
  getStudentUpcomingClasses,
  getTeacherUpcomingClasses,
  getClassesInRange,
  expandRecurrence,
  formatClassDateEs,
  formatClassTimeEs,
  type ClassWithPeople,
} from "../classes";
import { getClassBalance, canBookClass } from "../class-balance";
import { listTeacherClassSlots, berlinClockToUtcMs, type TrialSlot } from "../trial-slots";
import { resolveStudentTeacher, RESCHEDULE_CUTOFF_HOURS, STUDENT_CLASS_MINUTES } from "../student-schedule";
import { findTeacherConflicts } from "../teacher-conflicts";
import { getStudents } from "../academy";

/**
 * Herramientas del Asistente IA (MVP — Gelfis 2026-10-07).
 *
 * Dos familias:
 *   - consultas: solo lectura, scoped al usuario de la sesión.
 *   - proponer_*: NO escriben. Validan en lectura y devuelven una
 *     AccionPropuesta que la UI pinta como tarjeta; al confirmar, el
 *     NAVEGADOR llama al endpoint que ya existe (el mismo del botón
 *     manual), así que el asistente jamás puede hacer más que el usuario.
 */

export type AsistenteCtx =
  | { role: "student"; userId: string; name: string; studentId: string }
  | { role: "teacher"; userId: string; name: string; teacherId: string }
  | { role: "admin";   userId: string; name: string };

export type AccionPropuesta = {
  id:      string;
  tipo:    "agendar" | "reagendar" | "cancelar";
  titulo:  string;
  lineas:  string[];
  nota:    string | null;
  /** Texto de éxito tras confirmar (si no, el genérico del tipo). */
  hecho?:  string;
  request: { method: "POST" | "PATCH" | "DELETE"; url: string; body: Record<string, unknown> | null };
};

type ToolResult = Record<string, unknown>;
type ToolDef = {
  spec:  Anthropic.Tool;
  input: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run:   (input: any, acciones: AccionPropuesta[]) => Promise<ToolResult>;
};

const BERLIN = "Europe/Berlin";
const DEFAULT_MINUTES = STUDENT_CLASS_MINUTES;

// ── Helpers de fecha (todo en reloj de Berlín) ──────────────────────

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hora  = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Uuid  = z.string().uuid();

const fechaProp = { type: "string", description: "Fecha en Berlín, formato YYYY-MM-DD." } as const;
const horaProp  = { type: "string", description: "Hora de inicio en Berlín, formato HH:MM (24 h)." } as const;

function berlinToIso(fecha: string, hora: string): string {
  return new Date(berlinClockToUtcMs(new Date(`${fecha}T12:00:00Z`), `${hora}:00`)).toISOString();
}
function berlinDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN }).format(new Date(iso));
}
function fmt(iso: string): string {
  return `${formatClassDateEs(iso)} · ${formatClassTimeEs(iso)} (hora de Berlín)`;
}
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Los huecos más cercanos a un instante, en orden cronológico. */
function alternativas(slots: TrialSlot[], targetMs: number, n = 6) {
  return [...slots]
    .sort((a, b) => Math.abs(new Date(a.startIso).getTime() - targetMs) - Math.abs(new Date(b.startIso).getTime() - targetMs))
    .slice(0, n)
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
    .map(s => ({ fecha: berlinDate(s.startIso), hora: formatClassTimeEs(s.startIso), texto: fmt(s.startIso) }));
}

function resumenHuecos(slots: TrialSlot[], fecha?: string) {
  const porDia = new Map<string, string[]>();
  for (const s of slots) {
    const d = berlinDate(s.startIso);
    const list = porDia.get(d) ?? [];
    list.push(formatClassTimeEs(s.startIso));
    porDia.set(d, list);
  }
  const dia = (d: string) => ({ fecha: d, dia: formatClassDateEs(`${d}T12:00:00Z`), horas: porDia.get(d) ?? [] });
  if (fecha) {
    if (porDia.has(fecha)) return { dias: [dia(fecha)] };
    const cercanos = [...porDia.keys()].sort((a, b) =>
      Math.abs(Date.parse(a) - Date.parse(fecha)) - Math.abs(Date.parse(b) - Date.parse(fecha))).slice(0, 3).sort();
    return { sin_huecos_ese_dia: true, dias_cercanos_con_huecos: cercanos.map(dia) };
  }
  const dias = [...porDia.keys()].sort();
  return { dias: dias.slice(0, 7).map(dia), mas_dias_con_huecos: dias.slice(7) };
}

function claseDto(c: ClassWithPeople) {
  return {
    clase_id:    c.id,
    cuando:      fmt(c.scheduled_at),
    fecha:       berlinDate(c.scheduled_at),
    duracion_min: c.duration_minutes,
    tipo:        c.type === "group" ? "grupal" : "individual",
    titulo:      c.title,
    estado:      c.status,
    es_clase_de_prueba: c.is_trial,
    // Las clases de una misma serie recurrente comparten serie_id.
    serie_id:    c.recurrence_pattern !== "none" ? (c.parent_class_id ?? c.id) : null,
    profesor:    c.teacher_name,
    estudiantes: c.participants.map(p => p.student_name ?? p.student_email),
  };
}

// ── Lecturas compartidas ────────────────────────────────────────────

type ClaseLite = {
  id: string; type: string; status: string; is_trial: boolean; teacher_id: string | null;
  scheduled_at: string; duration_minutes: number; title: string;
  recurrence_pattern: string | null; parent_class_id: string | null; teacherName: string | null;
  students: Array<{ id: string; name: string | null }>;
};

async function loadClase(id: string): Promise<ClaseLite | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      id, type, status, is_trial, teacher_id, scheduled_at, duration_minutes, title, recurrence_pattern, parent_class_id,
      teacher:teachers!classes_teacher_id_fkey(users(full_name)),
      class_participants(student_id, student:students(users(full_name)))
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  const r = data as Record<string, unknown>;
  const t = one(r.teacher as { users: unknown } | Array<{ users: unknown }>);
  const tu = one(t?.users as { full_name: string | null } | Array<{ full_name: string | null }>);
  const parts = (r.class_participants as Array<{ student_id: string; student: unknown }> | null) ?? [];
  return {
    id:                 r.id as string,
    type:               r.type as string,
    status:             r.status as string,
    is_trial:           Boolean(r.is_trial),
    teacher_id:         (r.teacher_id as string | null) ?? null,
    scheduled_at:       r.scheduled_at as string,
    duration_minutes:   r.duration_minutes as number,
    title:              r.title as string,
    recurrence_pattern: (r.recurrence_pattern as string | null) ?? null,
    parent_class_id:    (r.parent_class_id as string | null) ?? null,
    teacherName:        tu?.full_name ?? null,
    students: parts.map(p => {
      const s = one(p.student as { users: unknown } | Array<{ users: unknown }>);
      const su = one(s?.users as { full_name: string | null } | Array<{ full_name: string | null }>);
      return { id: p.student_id, name: su?.full_name ?? null };
    }),
  };
}

/** Estudiantes ACTIVOS del profe: en un grupo activo suyo, con usuario activo y
 *  suscripción activa/pausa (Gelfis 2026-10-14: el profe solo ve a sus alumnos
 *  actuales en todas partes; antes bastaba con haber tenido una clase). */
async function teacherStudents(teacherId: string): Promise<Array<{ id: string; name: string }>> {
  const sb = supabaseAdmin();
  const { data: groups } = await sb.from("student_group_members")
    .select("student_id, group:student_groups!inner(teacher_id, active)")
    .eq("group.teacher_id", teacherId)
    .eq("group.active", true);
  const ids = new Set<string>();
  for (const r of (groups ?? []) as Array<{ student_id: string }>) ids.add(r.student_id);
  if (ids.size === 0) return [];
  const { data } = await sb
    .from("students")
    .select("id, users!inner(full_name, email, active)")
    .in("id", [...ids])
    .in("subscription_status", ["active", "paused"])
    .eq("users.active", true);
  return ((data ?? []) as Array<{ id: string; users: unknown }>).map(s => {
    const u = (Array.isArray(s.users) ? s.users[0] : s.users) as { full_name: string | null; email: string } | undefined;
    return { id: s.id, name: u?.full_name ?? u?.email ?? "Estudiante" };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function studentName(studentId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("students").select("users!inner(full_name, email)").eq("id", studentId).maybeSingle();
  if (!data) return null;
  const u = (data as { users: unknown }).users;
  const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
  return uu?.full_name ?? uu?.email ?? null;
}

async function teacherName(teacherId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("teachers").select("users!inner(full_name, email)").eq("id", teacherId).eq("active", true).maybeSingle();
  if (!data) return null;
  const u = (data as { users: unknown }).users;
  const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
  return uu?.full_name ?? uu?.email ?? null;
}

type SerieRow = { id: string; scheduled_at: string; duration_minutes: number };

/** Esta clase y las posteriores de su serie (misma regla que el PATCH de profe/admin). */
async function seriesFrom(c: ClaseLite, statuses: string[]): Promise<SerieRow[]> {
  const sb = supabaseAdmin();
  const parentId = c.parent_class_id ?? c.id;
  const { data } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes")
    .or(`id.eq.${parentId},parent_class_id.eq.${parentId}`)
    .gte("scheduled_at", c.scheduled_at)
    .in("status", statuses);
  const rows = (data ?? []) as SerieRow[];
  if (!rows.some(r => r.id === c.id)) rows.push({ id: c.id, scheduled_at: c.scheduled_at, duration_minutes: c.duration_minutes });
  return rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

/** Todas las clases aún agendadas de la serie (lo que cancela cancelClass({ whole: true })). */
async function seriesAllScheduled(c: ClaseLite): Promise<SerieRow[]> {
  const self = [{ id: c.id, scheduled_at: c.scheduled_at, duration_minutes: c.duration_minutes }];
  if (!c.parent_class_id) return self;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes")
    .eq("parent_class_id", c.parent_class_id)
    .eq("status", "scheduled");
  const rows = (data ?? []) as SerieRow[];
  return rows.length > 0 ? rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)) : self;
}

async function saldoDto(studentId: string) {
  const b = await getClassBalance(studentId);
  return {
    clases_disponibles_para_agendar: b.disponibles,
    clases_agendadas_futuras:        b.agendadas,
    clases_consumidas:               b.consumidas,
    clases_del_plan_total:           b.total,
    clases_por_mes:                  b.classesPerMonth,
  };
}

const fail = (motivo: string, extra: ToolResult = {}): ToolResult => ({ ok: false, motivo, ...extra });

function propuesta(acciones: AccionPropuesta[], a: Omit<AccionPropuesta, "id">): ToolResult {
  acciones.push({ ...a, id: `a${acciones.length + 1}_${Date.now().toString(36)}` });
  return {
    ok: true,
    propuesta_mostrada: true,
    aviso: "La acción AÚN NO se ha ejecutado. El usuario ve una tarjeta con el botón Confirmar; pídele que la revise y confirme.",
    resumen: [a.titulo, ...a.lineas],
  };
}

/** Validación común de una clase que se quiere mover/cancelar. */
function claseNoEditable(c: ClaseLite): string | null {
  if (c.is_trial) return "Es una clase de prueba: se gestiona desde la sección «Clases de prueba», no desde el asistente.";
  if (c.status !== "scheduled") return "La clase ya no está en estado «agendada», así que no se puede modificar.";
  return null;
}

// ── Estudiante ──────────────────────────────────────────────────────

function studentTools(ctx: Extract<AsistenteCtx, { role: "student" }>): ToolDef[] {
  return [
    {
      spec: {
        name: "mis_clases",
        description: "Próximas clases del estudiante (agendadas o en curso), con su clase_id.",
        input_schema: { type: "object", properties: {} },
      },
      input: z.object({}),
      run: async () => ({ clases: (await getStudentUpcomingClasses(ctx.studentId)).map(claseDto) }),
    },
    {
      spec: {
        name: "mi_saldo",
        description: "Saldo de clases del estudiante: disponibles para agendar, agendadas y consumidas.",
        input_schema: { type: "object", properties: {} },
      },
      input: z.object({}),
      run: async () => {
        const teacher = await resolveStudentTeacher(ctx.studentId);
        return { ...(await saldoDto(ctx.studentId)), profesor: teacher?.teacherName ?? null };
      },
    },
    {
      spec: {
        name: "huecos_disponibles",
        description: "Horarios libres reales del profesor del estudiante para una clase individual de 50 min (ya aplica 12 h de antelación). Con `fecha` devuelve ese día; sin ella, los próximos días con huecos.",
        input_schema: { type: "object", properties: { fecha: fechaProp } },
      },
      input: z.object({ fecha: Fecha.optional() }),
      run: async (i: { fecha?: string }) => {
        const teacher = await resolveStudentTeacher(ctx.studentId);
        if (!teacher) return fail("El estudiante aún no tiene profesor asignado.");
        return { profesor: teacher.teacherName, ...resumenHuecos(await listTeacherClassSlots(teacher.teacherId), i.fecha) };
      },
    },
    {
      spec: {
        name: "proponer_agendar",
        description: "Prepara (sin ejecutar) agendar una clase individual de 50 min con el profesor del estudiante. Si el horario no es un hueco libre devuelve alternativas reales.",
        input_schema: { type: "object", properties: { fecha: fechaProp, hora: horaProp }, required: ["fecha", "hora"] },
      },
      input: z.object({ fecha: Fecha, hora: Hora }),
      run: async (i: { fecha: string; hora: string }, acciones) => {
        const teacher = await resolveStudentTeacher(ctx.studentId);
        if (!teacher) return fail("El estudiante aún no tiene profesor asignado.");
        const startIso = berlinToIso(i.fecha, i.hora);
        const target = new Date(startIso).getTime();
        const slots = await listTeacherClassSlots(teacher.teacherId);
        if (!slots.some(s => new Date(s.startIso).getTime() === target)) {
          return fail("Ese horario exacto no está disponible (ocupado, fuera de la disponibilidad del profesor o con menos de 12 h de antelación).",
            { alternativas: alternativas(slots, target) });
        }
        const check = await canBookClass(ctx.studentId, 1);
        if (!check.allowed) return fail(check.reason ?? "No quedan clases disponibles en el plan.");
        return propuesta(acciones, {
          tipo:   "agendar",
          titulo: "Agendar clase",
          lineas: [fmt(startIso), `Con ${teacher.teacherName} · individual · ${DEFAULT_MINUTES} min`],
          nota:   "Tu profesor recibirá una notificación.",
          request: { method: "POST", url: "/api/student/schedule", body: { startIso } },
        });
      },
    },
    {
      spec: {
        name: "proponer_reagendar",
        description: "Prepara (sin ejecutar) mover una clase individual futura del estudiante a otro horario. Reglas: solo hasta 24 h antes de la clase original y el nuevo horario debe ser un hueco libre.",
        input_schema: {
          type: "object",
          properties: { clase_id: { type: "string", description: "clase_id obtenido de mis_clases." }, fecha: fechaProp, hora: horaProp },
          required: ["clase_id", "fecha", "hora"],
        },
      },
      input: z.object({ clase_id: Uuid, fecha: Fecha, hora: Hora }),
      run: async (i: { clase_id: string; fecha: string; hora: string }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !c.students.some(s => s.id === ctx.studentId)) return fail("No encuentro esa clase entre las del estudiante.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        if (c.type !== "individual") return fail("Las clases grupales las mueve el profesor.");
        const hours = (new Date(c.scheduled_at).getTime() - Date.now()) / 3_600_000;
        if (hours < RESCHEDULE_CUTOFF_HOURS) {
          return fail(`Solo se puede reagendar hasta ${RESCHEDULE_CUTOFF_HOURS} h antes de la clase. Sugiere escribir al profesor por Mensajes.`);
        }
        const teacher = await resolveStudentTeacher(ctx.studentId);
        const teacherId = teacher?.teacherId ?? c.teacher_id;
        if (!teacherId) return fail("La clase no tiene profesor asignado.");
        const startIso = berlinToIso(i.fecha, i.hora);
        const target = new Date(startIso).getTime();
        const slots = await listTeacherClassSlots(teacherId);
        if (!slots.some(s => new Date(s.startIso).getTime() === target)) {
          return fail("Ese horario exacto no está disponible.", { alternativas: alternativas(slots, target) });
        }
        return propuesta(acciones, {
          tipo:   "reagendar",
          titulo: "Reagendar clase",
          lineas: [`Antes: ${fmt(c.scheduled_at)}`, `Ahora: ${fmt(startIso)}`, c.title],
          nota:   "Tu profesor recibirá una notificación.",
          request: { method: "POST", url: `/api/student/schedule/${c.id}`, body: { startIso } },
        });
      },
    },
  ];
}

// ── Profesor y admin (misma forma, distinto alcance y endpoints) ────

function staffTools(ctx: Extract<AsistenteCtx, { role: "teacher" | "admin" }>): ToolDef[] {
  const isAdmin = ctx.role === "admin";
  const sb = supabaseAdmin();

  /** ¿Puede este usuario tocar esta clase? */
  const ownsClass = (c: ClaseLite) => isAdmin || (ctx.role === "teacher" && c.teacher_id === ctx.teacherId);

  const profesorProp = { type: "string", description: "profesor_id obtenido de buscar_profesores." } as const;
  const estudianteProp = {
    type: "string",
    description: `estudiante_id obtenido de ${isAdmin ? "buscar_estudiantes" : "mis_estudiantes"}.`,
  } as const;

  const tools: ToolDef[] = [];

  if (isAdmin) {
    tools.push(
      {
        spec: {
          name: "buscar_estudiantes",
          description: "Busca estudiantes activos por nombre o email. Devuelve estudiante_id, nombre, email y nivel. Si hay varios resultados que encajan, pregunta al usuario cuál.",
          input_schema: { type: "object", properties: { nombre: { type: "string" } }, required: ["nombre"] },
        },
        input: z.object({ nombre: z.string().trim().min(2).max(80) }),
        run: async (i: { nombre: string }) => {
          const { rows, total } = await getStudents({ q: i.nombre.replace(/[,()]/g, " "), limit: 10 });
          return {
            total,
            estudiantes: rows.map(r => ({ estudiante_id: r.id, nombre: r.full_name, email: r.email, nivel: r.current_level, suscripcion: r.subscription_status })),
          };
        },
      },
      {
        spec: {
          name: "buscar_profesores",
          description: "Lista los profesores activos (opcionalmente filtrados por nombre). Devuelve profesor_id y nombre.",
          input_schema: { type: "object", properties: { nombre: { type: "string" } } },
        },
        input: z.object({ nombre: z.string().trim().max(80).optional() }),
        run: async (i: { nombre?: string }) => {
          const { data } = await sb.from("teachers").select("id, users!inner(full_name, email, active)").eq("active", true).eq("users.active", true);
          const all = ((data ?? []) as Array<{ id: string; users: unknown }>).map(t => {
            const u = (Array.isArray(t.users) ? t.users[0] : t.users) as { full_name: string | null; email: string } | undefined;
            return { profesor_id: t.id, nombre: u?.full_name ?? u?.email ?? "" };
          });
          const q = i.nombre ? norm(i.nombre) : "";
          return { profesores: q ? all.filter(t => norm(t.nombre).includes(q)) : all };
        },
      },
      {
        spec: {
          name: "clases",
          description: "Clases de la academia en un rango de fechas (máx. 120 días), opcionalmente filtradas por profesor o estudiante. Incluye clase_id y estado. Para ver TODAS las clases futuras de un estudiante usa un rango amplio (p. ej. hoy + 120 días) y filtra por estudiante_id. Si la respuesta trae rango_recortado o truncado, faltan clases: dilo o vuelve a consultar.",
          input_schema: {
            type: "object",
            properties: {
              desde: fechaProp,
              hasta: { type: "string", description: "Fecha fin inclusive YYYY-MM-DD. Por defecto, igual a `desde`." },
              profesor_id: profesorProp,
              estudiante_id: estudianteProp,
            },
            required: ["desde"],
          },
        },
        input: z.object({ desde: Fecha, hasta: Fecha.optional(), profesor_id: Uuid.optional(), estudiante_id: Uuid.optional() }),
        run: async (i: { desde: string; hasta?: string; profesor_id?: string; estudiante_id?: string }) => {
          const from = new Date(berlinToIso(i.desde, "00:00"));
          let to = new Date(new Date(berlinToIso(i.hasta ?? i.desde, "23:59")).getTime() + 59_000);
          const max = from.getTime() + 120 * 24 * 3600_000;
          const recortado = to.getTime() > max;
          if (recortado) to = new Date(max);
          let rows = await getClassesInRange(from, to);
          if (i.profesor_id)   rows = rows.filter(c => c.teacher_id === i.profesor_id);
          if (i.estudiante_id) rows = rows.filter(c => c.participants.some(p => p.student_id === i.estudiante_id));
          return {
            total: rows.length, consultado_hasta: berlinDate(to), rango_recortado: recortado,
            truncado: rows.length > 150, clases: rows.slice(0, 150).map(claseDto),
          };
        },
      },
    );
  } else {
    const teacherId = ctx.teacherId;
    tools.push(
      {
        spec: {
          name: "mis_clases",
          description: "Próximas clases agendadas del profesor, con clase_id, estudiantes y tipo. Por defecto los próximos 30 días; para ver TODAS las clases futuras con un estudiante pasa su estudiante_id y dias=120. Si la respuesta trae truncado, faltan clases: dilo o filtra por estudiante.",
          input_schema: {
            type: "object",
            properties: {
              dias: { type: "integer", description: "Días hacia delante a consultar (1–120). Por defecto 30." },
              estudiante_id: { type: "string", description: "Filtra por un estudiante (estudiante_id de mis_estudiantes)." },
            },
          },
        },
        input: z.object({ dias: z.number().int().min(1).max(120).optional(), estudiante_id: Uuid.optional() }),
        run: async (i: { dias?: number; estudiante_id?: string }) => {
          const dias = i.dias ?? 30;
          let rows = await getTeacherUpcomingClasses(teacherId, new Date(), dias);
          if (i.estudiante_id) rows = rows.filter(c => c.participants.some(p => p.student_id === i.estudiante_id));
          return { total: rows.length, dias_consultados: dias, truncado: rows.length > 150, clases: rows.slice(0, 150).map(claseDto) };
        },
      },
      {
        spec: {
          name: "mis_estudiantes",
          description: "Estudiantes del profesor, opcionalmente filtrados por nombre. Devuelve estudiante_id y nombre. Si varios encajan con el nombre pedido, pregunta al usuario cuál.",
          input_schema: { type: "object", properties: { nombre: { type: "string" } } },
        },
        input: z.object({ nombre: z.string().trim().max(80).optional() }),
        run: async (i: { nombre?: string }) => {
          const all = await teacherStudents(teacherId);
          const q = i.nombre ? norm(i.nombre) : "";
          const hits = q ? all.filter(s => norm(s.name).includes(q)) : all;
          return { estudiantes: hits.slice(0, 60).map(s => ({ estudiante_id: s.id, nombre: s.name })) };
        },
      },
    );
  }

  /** Resuelve y valida el profe sobre el que se opera. */
  const resolveTeacher = async (profesorId?: string): Promise<{ id: string; name: string } | string> => {
    if (ctx.role === "teacher") return { id: ctx.teacherId, name: ctx.name };
    if (!profesorId) return "Falta profesor_id (usa buscar_profesores).";
    const name = await teacherName(profesorId);
    return name ? { id: profesorId, name } : "No encuentro ese profesor activo.";
  };
  /** Valida que el estudiante existe y (para el profe) que es suyo. */
  const resolveStudent = async (studentId: string): Promise<{ id: string; name: string } | string> => {
    if (ctx.role === "teacher") {
      const s = (await teacherStudents(ctx.teacherId)).find(x => x.id === studentId);
      return s ?? "Ese estudiante no está entre los del profesor.";
    }
    const name = await studentName(studentId);
    return name ? { id: studentId, name } : "No encuentro ese estudiante.";
  };

  tools.push(
    {
      spec: {
        name: "saldo_estudiante",
        description: "Saldo de clases de un estudiante: disponibles para agendar, agendadas y consumidas.",
        input_schema: { type: "object", properties: { estudiante_id: estudianteProp }, required: ["estudiante_id"] },
      },
      input: z.object({ estudiante_id: Uuid }),
      run: async (i: { estudiante_id: string }) => {
        const s = await resolveStudent(i.estudiante_id);
        if (typeof s === "string") return fail(s);
        return { estudiante: s.name, ...(await saldoDto(s.id)) };
      },
    },
    {
      spec: {
        name: "huecos_disponibles",
        description: `Huecos libres ${isAdmin ? "de un profesor" : "del profesor"} según el motor (disponibilidad − clases − bloqueos − Google Calendar, pausa de 10 min, 12 h de antelación) para clases de 50 min. Con \`fecha\` devuelve ese día; sin ella, los próximos días.`,
        input_schema: {
          type: "object",
          properties: isAdmin ? { profesor_id: profesorProp, fecha: fechaProp } : { fecha: fechaProp },
          ...(isAdmin ? { required: ["profesor_id"] } : {}),
        },
      },
      input: z.object({ profesor_id: Uuid.optional(), fecha: Fecha.optional() }),
      run: async (i: { profesor_id?: string; fecha?: string }) => {
        const t = await resolveTeacher(i.profesor_id);
        if (typeof t === "string") return fail(t);
        return { profesor: t.name, ...resumenHuecos(await listTeacherClassSlots(t.id), i.fecha) };
      },
    },
    {
      spec: {
        name: "proponer_agendar",
        description: "Prepara (sin ejecutar) una clase individual con un estudiante: suelta o, con `repetir`, una serie semanal o quincenal el mismo día y hora hasta `repetir_hasta`. Comprueba solapes con otras clases del profesor (en todas las fechas de la serie) y el saldo del estudiante. Para dos días por semana, haz una propuesta por día.",
        input_schema: {
          type: "object",
          properties: {
            ...(isAdmin ? { profesor_id: profesorProp } : {}),
            estudiante_id: estudianteProp,
            fecha: { type: "string", description: "Fecha de la primera clase en Berlín, YYYY-MM-DD." },
            hora: horaProp,
            duracion_minutos: { type: "integer", description: "Duración en minutos (15–240). Por defecto 50." },
            repetir: { type: "string", enum: ["no", "semanal", "quincenal"], description: "Recurrencia. Por defecto «no» (clase suelta)." },
            repetir_hasta: { type: "string", description: "Última fecha posible de la serie, YYYY-MM-DD. Obligatoria si `repetir` no es «no»; pregúntala al usuario si no la dijo." },
          },
          required: [...(isAdmin ? ["profesor_id"] : []), "estudiante_id", "fecha", "hora"],
        },
      },
      input: z.object({
        profesor_id: Uuid.optional(), estudiante_id: Uuid, fecha: Fecha, hora: Hora,
        duracion_minutos: z.number().int().min(15).max(240).optional(),
        repetir: z.enum(["no", "semanal", "quincenal"]).optional(),
        repetir_hasta: Fecha.optional(),
      }),
      run: async (i: {
        profesor_id?: string; estudiante_id: string; fecha: string; hora: string;
        duracion_minutos?: number; repetir?: "no" | "semanal" | "quincenal"; repetir_hasta?: string;
      }, acciones) => {
        const t = await resolveTeacher(i.profesor_id);
        if (typeof t === "string") return fail(t);
        const s = await resolveStudent(i.estudiante_id);
        if (typeof s === "string") return fail(s);
        const startIso = berlinToIso(i.fecha, i.hora);
        if (new Date(startIso).getTime() <= Date.now()) return fail("Ese horario ya pasó.");
        const minutes = i.duracion_minutos ?? DEFAULT_MINUTES;

        const pattern = i.repetir === "semanal" ? "weekly" : i.repetir === "quincenal" ? "biweekly" : "none";
        if (pattern !== "none" && !i.repetir_hasta) return fail("Falta `repetir_hasta`: pregunta al usuario hasta qué fecha se repite la serie.");
        if (pattern !== "none" && i.repetir_hasta! <= i.fecha) return fail("`repetir_hasta` debe ser posterior a la primera clase.");
        // Mismas fechas que generará createClass (hora de reloj de Berlín estable).
        const dates = expandRecurrence(
          new Date(startIso), pattern,
          pattern === "none" ? null : new Date(`${i.repetir_hasta}T23:59:59Z`),
        );

        for (const d of dates) {
          const conflicts = await findTeacherConflicts(sb, { teacherId: t.id, startIso: d.toISOString(), durationMinutes: minutes, breakMinutes: 0 });
          if (conflicts.length > 0) {
            return fail(`El ${fmt(d.toISOString())} se pisa con otra clase del profesor (${fmt(conflicts[0].scheduled_at)}).`,
              dates.length === 1 ? { alternativas: alternativas(await listTeacherClassSlots(t.id), d.getTime()) } : {});
          }
        }
        const check = await canBookClass(s.id, dates.length);
        if (!check.allowed) {
          return fail(`${s.name} no tiene suficientes clases disponibles en su plan para ${dates.length === 1 ? "esta clase" : `${dates.length} clases`}.`,
            { saldo: await saldoDto(s.id) });
        }

        const title = `Clase de alemán — ${firstName(s.name) || s.name}`;
        const serie = dates.length > 1;
        const last = dates[dates.length - 1].toISOString();
        const body = {
          type: "individual", ...(isAdmin ? { teacherId: t.id } : {}), studentIds: [s.id],
          scheduledAt: startIso, durationMinutes: minutes, title,
          ...(pattern !== "none" ? { recurrencePattern: pattern, recurrenceEndDate: i.repetir_hasta } : {}),
        };
        return propuesta(acciones, {
          tipo:   "agendar",
          titulo: serie ? `Agendar serie (${dates.length} clases)` : "Agendar clase",
          lineas: [
            serie ? `Primera: ${fmt(startIso)}` : fmt(startIso),
            ...(serie ? [`Se repite ${pattern === "weekly" ? "cada semana" : "cada dos semanas"} · última: ${formatClassDateEs(last)}`] : []),
            `${s.name} con ${t.name} · individual · ${minutes} min`,
          ],
          nota:   isAdmin
            ? "El estudiante y el profesor recibirán email y notificación."
            : "El estudiante recibirá email y notificación.",
          hecho:  serie ? `Serie agendada (${dates.length} clases)` : undefined,
          request: { method: "POST", url: `/api/${isAdmin ? "admin" : "teacher"}/classes`, body },
        });
      },
    },
    {
      spec: {
        name: "proponer_modificar",
        description: "Prepara (sin ejecutar) un cambio sobre una clase agendada: moverla de día/hora (`fecha` + `hora`), cambiar su duración (`duracion_minutos`), o ambas. Con alcance «serie» se aplica a esa clase y a TODAS las posteriores de su serie: todas se desplazan el mismo intervalo que la clase indicada, así que usa como clase_id la PRÓXIMA clase de la serie. Comprueba solapes con otras clases del profesor.",
        input_schema: {
          type: "object",
          properties: {
            clase_id: { type: "string", description: "clase_id obtenido de una consulta de clases." },
            fecha: { type: "string", description: "Nueva fecha de ESA clase en Berlín, YYYY-MM-DD (junto con `hora`)." },
            hora: { type: "string", description: "Nueva hora de inicio en Berlín, HH:MM (junto con `fecha`)." },
            duracion_minutos: { type: "integer", description: "Nueva duración en minutos (15–240)." },
            alcance: { type: "string", enum: ["esta", "serie"], description: "«esta» (por defecto) solo esa clase; «serie» esa y las posteriores de la serie." },
          },
          required: ["clase_id"],
        },
      },
      input: z.object({
        clase_id: Uuid, fecha: Fecha.optional(), hora: Hora.optional(),
        duracion_minutos: z.number().int().min(15).max(240).optional(),
        alcance: z.enum(["esta", "serie"]).optional(),
      }),
      run: async (i: { clase_id: string; fecha?: string; hora?: string; duracion_minutos?: number; alcance?: "esta" | "serie" }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !ownsClass(c)) return fail("No encuentro esa clase.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        if (Boolean(i.fecha) !== Boolean(i.hora)) return fail("Para mover la clase hacen falta `fecha` y `hora` juntas.");
        const moves = Boolean(i.fecha && i.hora);
        const newMinutes = i.duracion_minutos !== undefined && i.duracion_minutos !== c.duration_minutes ? i.duracion_minutos : undefined;
        const startIso = moves ? berlinToIso(i.fecha!, i.hora!) : c.scheduled_at;
        const deltaMs = new Date(startIso).getTime() - new Date(c.scheduled_at).getTime();
        if (deltaMs === 0 && newMinutes === undefined) return fail("No hay ningún cambio: la clase ya tiene ese horario y esa duración.");
        if (moves && new Date(startIso).getTime() <= Date.now()) return fail("Ese horario ya pasó.");

        const serie = i.alcance === "serie";
        const targets = serie ? await seriesFrom(c, isAdmin ? ["scheduled", "live"] : ["scheduled"]) : [c];
        const ids = targets.map(x => x.id);
        if (c.teacher_id) {
          for (const x of targets) {
            const at = new Date(new Date(x.scheduled_at).getTime() + deltaMs).toISOString();
            const conflicts = await findTeacherConflicts(sb, {
              teacherId: c.teacher_id, startIso: at, durationMinutes: newMinutes ?? x.duration_minutes, excludeIds: ids, breakMinutes: 0,
            });
            if (conflicts.length > 0) {
              return fail(`Con ese cambio, la clase del ${fmt(at)} se pisa con otra clase del profesor (${fmt(conflicts[0].scheduled_at)}).`,
                !serie && moves ? { alternativas: alternativas(await listTeacherClassSlots(c.teacher_id), new Date(startIso).getTime()) } : {});
            }
          }
        }

        const quien = c.students.map(s => s.name).filter(Boolean).join(", ");
        const n = targets.length;
        const lineas = [
          ...(deltaMs !== 0 ? [`${n > 1 ? "Próxima, antes" : "Antes"}: ${fmt(c.scheduled_at)}`, `${n > 1 ? "Próxima, ahora" : "Ahora"}: ${fmt(startIso)}`] : [fmt(c.scheduled_at)]),
          ...(newMinutes !== undefined ? [`Duración: ${c.duration_minutes} → ${newMinutes} min`] : []),
          ...(n > 1 ? [`Se aplica a ${n} clases de la serie (hasta el ${formatClassDateEs(new Date(new Date(targets[n - 1].scheduled_at).getTime() + deltaMs))})`] : []),
          [c.title, quien].filter(Boolean).join(" · "),
        ];
        const titulo =
          (deltaMs !== 0 ? (n > 1 ? "Reprogramar serie" : "Reagendar clase") : (n > 1 ? "Cambiar duración de la serie" : "Cambiar duración"));
        return propuesta(acciones, {
          tipo:   "reagendar",
          titulo,
          lineas,
          nota:   isAdmin
            ? "Desde el panel de admin este cambio NO avisa automáticamente al estudiante ni al profesor."
            : "Los estudiantes recibirán email y notificación.",
          hecho:  n > 1 ? `Serie actualizada (${n} clases)` : deltaMs !== 0 ? undefined : "Duración actualizada",
          request: isAdmin
            ? { method: "PATCH", url: `/api/admin/classes/${c.id}`, body: {
                scope: serie ? "series" : "this",
                ...(deltaMs !== 0 ? { scheduled_at: startIso } : {}),
                ...(newMinutes !== undefined ? { duration_minutes: newMinutes } : {}),
              } }
            : { method: "PATCH", url: `/api/teacher/classes/${c.id}`, body: {
                scope: serie ? "series" : "this",
                ...(deltaMs !== 0 ? { scheduledAt: startIso } : {}),
                ...(newMinutes !== undefined ? { durationMinutes: newMinutes } : {}),
              } },
        });
      },
    },
    {
      spec: {
        name: "proponer_cancelar",
        description: `Prepara (sin ejecutar) cancelar una clase agendada. Con alcance «serie» cancela ${isAdmin ? "todas las clases aún agendadas de su serie" : "esa clase y todas las posteriores de su serie"}.`,
        input_schema: {
          type: "object",
          properties: {
            clase_id: { type: "string", description: "clase_id obtenido de una consulta de clases." },
            alcance: { type: "string", enum: ["esta", "serie"], description: "«esta» (por defecto) o «serie»." },
          },
          required: ["clase_id"],
        },
      },
      input: z.object({ clase_id: Uuid, alcance: z.enum(["esta", "serie"]).optional() }),
      run: async (i: { clase_id: string; alcance?: "esta" | "serie" }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !ownsClass(c)) return fail("No encuentro esa clase.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        const serie = i.alcance === "serie";
        // Admin: cancelClass({whole}) cancela TODA la serie aún agendada; profe: desde esta clase en adelante.
        const targets = !serie ? [c] : isAdmin ? await seriesAllScheduled(c) : await seriesFrom(c, ["scheduled"]);
        const n = targets.length;
        const quien = c.students.map(s => s.name).filter(Boolean).join(", ");
        return propuesta(acciones, {
          tipo:   "cancelar",
          titulo: n > 1 ? `Cancelar serie (${n} clases)` : "Cancelar clase",
          lineas: [
            n > 1 ? `Del ${fmt(targets[0].scheduled_at)} al ${formatClassDateEs(targets[n - 1].scheduled_at)}` : fmt(c.scheduled_at),
            [c.title, quien, c.teacherName && isAdmin ? `Prof. ${c.teacherName}` : null].filter(Boolean).join(" · "),
          ],
          nota:   isAdmin
            ? "Desde el panel de admin la cancelación NO avisa automáticamente al estudiante ni al profesor."
            : "Los estudiantes recibirán email y notificación de la cancelación.",
          hecho:  n > 1 ? `Serie cancelada (${n} clases)` : undefined,
          request: {
            method: "DELETE",
            url: isAdmin
              ? `/api/admin/classes/${c.id}${serie ? "?whole=1" : ""}`
              : `/api/teacher/classes/${c.id}${serie ? "?scope=series" : ""}`,
            body: null,
          },
        });
      },
    },
  );

  return tools;
}

export function toolsFor(ctx: AsistenteCtx): ToolDef[] {
  return ctx.role === "student" ? studentTools(ctx) : staffTools(ctx);
}

/** Ejecuta una tool validando su input; nunca lanza (devuelve error para el modelo). */
export async function runTool(
  tools: ToolDef[],
  name: string,
  rawInput: unknown,
  acciones: AccionPropuesta[],
): Promise<{ content: string; isError: boolean }> {
  const tool = tools.find(t => t.spec.name === name);
  if (!tool) return { content: `Herramienta desconocida: ${name}`, isError: true };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: `Parámetros inválidos: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`, isError: true };
  }
  try {
    return { content: JSON.stringify(await tool.run(parsed.data, acciones)), isError: false };
  } catch (e) {
    console.error(`[asistente] tool ${name} failed:`, e);
    return { content: "Error interno al consultar los datos. Inténtalo de nuevo.", isError: true };
  }
}
