import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import {
  getStudentUpcomingClasses,
  getTeacherUpcomingClasses,
  getClassesInRange,
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
    profesor:    c.teacher_name,
    estudiantes: c.participants.map(p => p.student_name ?? p.student_email),
  };
}

// ── Lecturas compartidas ────────────────────────────────────────────

type ClaseLite = {
  id: string; type: string; status: string; is_trial: boolean; teacher_id: string | null;
  scheduled_at: string; duration_minutes: number; title: string;
  recurrence_pattern: string | null; teacherName: string | null;
  students: Array<{ id: string; name: string | null }>;
};

async function loadClase(id: string): Promise<ClaseLite | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      id, type, status, is_trial, teacher_id, scheduled_at, duration_minutes, title, recurrence_pattern,
      teacher:teachers(users(full_name)),
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
    teacherName:        tu?.full_name ?? null,
    students: parts.map(p => {
      const s = one(p.student as { users: unknown } | Array<{ users: unknown }>);
      const su = one(s?.users as { full_name: string | null } | Array<{ full_name: string | null }>);
      return { id: p.student_id, name: su?.full_name ?? null };
    }),
  };
}

/** Estudiantes del profe: con clase suya o en un grupo activo suyo (misma regla que POST /api/teacher/classes). */
async function teacherStudents(teacherId: string): Promise<Array<{ id: string; name: string }>> {
  const sb = supabaseAdmin();
  const [mine, groups] = await Promise.all([
    sb.from("classes").select("class_participants!inner(student_id)").eq("teacher_id", teacherId),
    sb.from("student_group_members")
      .select("student_id, group:student_groups!inner(teacher_id, active)")
      .eq("group.teacher_id", teacherId)
      .eq("group.active", true),
  ]);
  const ids = new Set<string>();
  for (const r of (mine.data ?? []) as Array<{ class_participants: Array<{ student_id: string }> }>) {
    for (const cp of r.class_participants) ids.add(cp.student_id);
  }
  for (const r of (groups.data ?? []) as Array<{ student_id: string }>) ids.add(r.student_id);
  if (ids.size === 0) return [];
  const { data } = await sb
    .from("students")
    .select("id, users!inner(full_name, email, active)")
    .in("id", [...ids])
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
          description: "Clases de la academia en un rango de fechas (máx. 31 días), opcionalmente filtradas por profesor o estudiante. Incluye clase_id y estado.",
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
          const max = from.getTime() + 31 * 24 * 3600_000;
          if (to.getTime() > max) to = new Date(max);
          let rows = await getClassesInRange(from, to);
          if (i.profesor_id)   rows = rows.filter(c => c.teacher_id === i.profesor_id);
          if (i.estudiante_id) rows = rows.filter(c => c.participants.some(p => p.student_id === i.estudiante_id));
          return { total: rows.length, truncado: rows.length > 60, clases: rows.slice(0, 60).map(claseDto) };
        },
      },
    );
  } else {
    const teacherId = ctx.teacherId;
    tools.push(
      {
        spec: {
          name: "mis_clases",
          description: "Próximas clases del profesor (30 días), con clase_id, estudiantes y tipo.",
          input_schema: { type: "object", properties: {} },
        },
        input: z.object({}),
        run: async () => ({ clases: (await getTeacherUpcomingClasses(teacherId)).map(claseDto) }),
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
        description: "Prepara (sin ejecutar) una clase individual suelta con un estudiante. Comprueba solapes con otras clases del profesor y el saldo del estudiante. Si hay solape devuelve alternativas reales.",
        input_schema: {
          type: "object",
          properties: {
            ...(isAdmin ? { profesor_id: profesorProp } : {}),
            estudiante_id: estudianteProp,
            fecha: fechaProp,
            hora: horaProp,
            duracion_minutos: { type: "integer", description: "Duración en minutos (15–240). Por defecto 50." },
          },
          required: [...(isAdmin ? ["profesor_id"] : []), "estudiante_id", "fecha", "hora"],
        },
      },
      input: z.object({
        profesor_id: Uuid.optional(), estudiante_id: Uuid, fecha: Fecha, hora: Hora,
        duracion_minutos: z.number().int().min(15).max(240).optional(),
      }),
      run: async (i: { profesor_id?: string; estudiante_id: string; fecha: string; hora: string; duracion_minutos?: number }, acciones) => {
        const t = await resolveTeacher(i.profesor_id);
        if (typeof t === "string") return fail(t);
        const s = await resolveStudent(i.estudiante_id);
        if (typeof s === "string") return fail(s);
        const startIso = berlinToIso(i.fecha, i.hora);
        const target = new Date(startIso).getTime();
        if (target <= Date.now()) return fail("Ese horario ya pasó.");
        const minutes = i.duracion_minutos ?? DEFAULT_MINUTES;
        const conflicts = await findTeacherConflicts(sb, { teacherId: t.id, startIso, durationMinutes: minutes, breakMinutes: 0 });
        if (conflicts.length > 0) {
          return fail(`Ese horario se pisa con otra clase del profesor (${fmt(conflicts[0].scheduled_at)}).`,
            { alternativas: alternativas(await listTeacherClassSlots(t.id), target) });
        }
        const check = await canBookClass(s.id, 1);
        if (!check.allowed) return fail(`${s.name} no tiene clases disponibles en su plan.`);
        const title = `Clase de alemán — ${firstName(s.name) || s.name}`;
        return propuesta(acciones, {
          tipo:   "agendar",
          titulo: "Agendar clase",
          lineas: [fmt(startIso), `${s.name} con ${t.name} · individual · ${minutes} min`],
          nota:   isAdmin
            ? "El estudiante y el profesor recibirán email y notificación."
            : "El estudiante recibirá email y notificación.",
          request: isAdmin
            ? { method: "POST", url: "/api/admin/classes", body: { type: "individual", teacherId: t.id, studentIds: [s.id], scheduledAt: startIso, durationMinutes: minutes, title } }
            : { method: "POST", url: "/api/teacher/classes", body: { type: "individual", studentIds: [s.id], scheduledAt: startIso, durationMinutes: minutes, title } },
        });
      },
    },
    {
      spec: {
        name: "proponer_reagendar",
        description: "Prepara (sin ejecutar) mover UNA clase agendada a otro horario (no la serie). Comprueba solapes con otras clases del profesor.",
        input_schema: {
          type: "object",
          properties: { clase_id: { type: "string", description: "clase_id obtenido de una consulta de clases." }, fecha: fechaProp, hora: horaProp },
          required: ["clase_id", "fecha", "hora"],
        },
      },
      input: z.object({ clase_id: Uuid, fecha: Fecha, hora: Hora }),
      run: async (i: { clase_id: string; fecha: string; hora: string }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !ownsClass(c)) return fail("No encuentro esa clase.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        const startIso = berlinToIso(i.fecha, i.hora);
        const target = new Date(startIso).getTime();
        if (target <= Date.now()) return fail("Ese horario ya pasó.");
        if (c.teacher_id) {
          const conflicts = await findTeacherConflicts(sb, {
            teacherId: c.teacher_id, startIso, durationMinutes: c.duration_minutes, excludeClassId: c.id, breakMinutes: 0,
          });
          if (conflicts.length > 0) {
            return fail(`Ese horario se pisa con otra clase del profesor (${fmt(conflicts[0].scheduled_at)}).`,
              { alternativas: alternativas(await listTeacherClassSlots(c.teacher_id), target) });
          }
        }
        const quien = c.students.map(s => s.name).filter(Boolean).join(", ");
        return propuesta(acciones, {
          tipo:   "reagendar",
          titulo: "Reagendar clase",
          lineas: [`Antes: ${fmt(c.scheduled_at)}`, `Ahora: ${fmt(startIso)}`, [c.title, quien].filter(Boolean).join(" · ")],
          nota:   isAdmin
            ? "Desde el panel de admin este cambio NO avisa automáticamente al estudiante ni al profesor."
            : "Los estudiantes recibirán email y notificación.",
          request: isAdmin
            ? { method: "PATCH", url: `/api/admin/classes/${c.id}`, body: { scope: "this", scheduled_at: startIso } }
            : { method: "PATCH", url: `/api/teacher/classes/${c.id}`, body: { scope: "this", scheduledAt: startIso } },
        });
      },
    },
    {
      spec: {
        name: "proponer_cancelar",
        description: "Prepara (sin ejecutar) cancelar UNA clase agendada (no la serie).",
        input_schema: {
          type: "object",
          properties: { clase_id: { type: "string", description: "clase_id obtenido de una consulta de clases." } },
          required: ["clase_id"],
        },
      },
      input: z.object({ clase_id: Uuid }),
      run: async (i: { clase_id: string }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !ownsClass(c)) return fail("No encuentro esa clase.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        const quien = c.students.map(s => s.name).filter(Boolean).join(", ");
        return propuesta(acciones, {
          tipo:   "cancelar",
          titulo: "Cancelar clase",
          lineas: [fmt(c.scheduled_at), [c.title, quien, c.teacherName && isAdmin ? `Prof. ${c.teacherName}` : null].filter(Boolean).join(" · ")],
          nota:   isAdmin
            ? "Desde el panel de admin la cancelación NO avisa automáticamente al estudiante ni al profesor."
            : "Los estudiantes recibirán email y notificación de la cancelación.",
          request: { method: "DELETE", url: `/api/${isAdmin ? "admin" : "teacher"}/classes/${c.id}`, body: null },
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
