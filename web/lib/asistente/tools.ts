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
import { getStudentHomework } from "../homework";
import { getStudentRecordings, getTeacherRecordings } from "../recordings";
import { getTeacherEarningsSummary } from "../finance";
import { listEpisodes } from "../serie";
import { listSharedMaterials } from "../shared-materials";
import { listMaterialsVisibleToStudent } from "../materials";
import { planMover, MAX_MOVER, type Actor } from "./mover";

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
  | { role: "student"; userId: string; name: string; lang: Lang; studentId: string; nivel: string | null; meta: string | null }
  | { role: "teacher"; userId: string; name: string; lang: Lang; teacherId: string }
  | { role: "admin";   userId: string; name: string; lang: Lang };

export type Lang = "es" | "de";

export type AccionPropuesta = {
  id:      string;
  tipo:    "agendar" | "reagendar" | "cancelar" | "mover" | "bloquear" | "mensaje";
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
export async function teacherStudents(teacherId: string): Promise<Array<{ id: string; name: string }>> {
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

/** Herramienta común: lo que el asistente no pudo resolver (lo intercepta la ruta). */
const NO_RESUELTO_SPEC: ToolDef = {
  spec: {
    name: "registrar_no_resuelto",
    description: "Anota para la academia una petición que NO has podido resolver porque no tienes herramienta o información para ello. Úsala una vez, además de responder al usuario. No la uses para preguntas de alemán ni cuando solo falte un dato que puedes preguntar.",
    input_schema: { type: "object", properties: { motivo: { type: "string", description: "Qué pedía el usuario y por qué no se pudo, en una frase." } }, required: ["motivo"] },
  },
  input: z.object({ motivo: z.string() }),
  run: async () => ({ ok: true }),
};

/** Tarjeta para mover varias clases a la vez: mismo plan que revalidará el endpoint. */
async function propuestaMover(
  actor: Actor,
  i: { clase_ids: string[]; hora: string; desplazar_dias?: number },
  acciones: AccionPropuesta[],
  nota: string,
  lang: Lang = "es",
): Promise<ToolResult> {
  const plan = await planMover(actor, { classIds: i.clase_ids, hora: i.hora, desplazarDias: i.desplazar_dias });
  if (!plan.ok) return fail(plan.motivo);
  const m = plan.moves;
  const n = m.length;
  const de = lang === "de";
  return propuesta(acciones, {
    tipo:   "mover",
    titulo: n > 1 ? (de ? `${n} Stunden verschieben` : `Mover ${n} clases`) : (de ? "Stunde verschieben" : "Mover clase"),
    lineas: [
      `${de ? "Erste" : "Primera"}: ${fmt(m[0].from)} → ${fmt(m[0].to)}`,
      ...(n > 1 ? [`${de ? "Letzte" : "Última"}: ${fmt(m[n - 1].from)} → ${fmt(m[n - 1].to)}`] : []),
    ],
    nota,
    hecho:  n > 1 ? (de ? `${n} Stunden verschoben` : `${n} clases movidas`) : undefined,
    request: { method: "POST", url: "/api/asistente/mover-clases", body: { classIds: i.clase_ids, hora: i.hora, ...(i.desplazar_dias ? { desplazarDias: i.desplazar_dias } : {}) } },
  });
}

const moverSpec = (descripcion: string): Anthropic.Tool => ({
  name: "proponer_mover_varias",
  description: `Prepara (sin ejecutar) UNA sola tarjeta que mueve varias clases sueltas (hasta ${MAX_MOVER}) a una hora nueva, con un solo aviso. ${descripcion} Si cambian de día de la semana, usa desplazar_dias y una tarjeta por cada día de la semana de origen. No mezcles aquí las dos clases de una doble: quedarían pisadas.`,
  input_schema: {
    type: "object",
    properties: {
      clase_ids: { type: "array", items: { type: "string" }, description: "clase_id de cada clase a mover." },
      hora: { type: "string", description: "Nueva hora de inicio en Berlín, HH:MM." },
      desplazar_dias: { type: "integer", description: "Días a sumar o restar a cada clase (-6 a 6). Por defecto 0: mismo día." },
    },
    required: ["clase_ids", "hora"],
  },
});
const MoverInput = z.object({ clase_ids: z.array(Uuid).min(1).max(MAX_MOVER), hora: Hora, desplazar_dias: z.number().int().min(-6).max(6).optional() });

/** Chat directo ya existente entre dos usuarios (no crea nada). */
async function directChat(a: string, b: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("chat_participants").select("chat_id, user_id, chats!inner(type)").in("user_id", [a, b]).eq("chats.type", "direct");
  const seen = new Map<string, Set<string>>();
  for (const r of (data ?? []) as Array<{ chat_id: string; user_id: string }>) {
    const set = seen.get(r.chat_id) ?? new Set<string>();
    set.add(r.user_id);
    seen.set(r.chat_id, set);
  }
  for (const [id, set] of seen) if (set.has(a) && set.has(b)) return id;
  return null;
}

function propuestaMensaje(acciones: AccionPropuesta[], chatId: string, destinatario: string, texto: string, lang: Lang = "es"): ToolResult {
  const de = lang === "de";
  return propuesta(acciones, {
    tipo:   "mensaje",
    titulo: `${de ? "Nachricht an" : "Mensaje para"} ${destinatario}`,
    lineas: [`«${texto}»`],
    nota:   de ? "Wird in deinem Namen im Chat gesendet." : "Se envía en tu nombre por el chat de la plataforma.",
    hecho:  de ? "Nachricht gesendet" : "Mensaje enviado",
    request: { method: "POST", url: `/api/chat/${chatId}/messages`, body: { content: texto } },
  });
}

/** Busca material de estudio por palabras (vídeos de la serie y lecciones oficiales). */
async function buscarMaterial(texto: string, studentId: string | null) {
  const q = norm(texto);
  const hit = (...v: Array<string | null | undefined>) => !q || v.some(x => x && norm(x).includes(q));
  const [eps, shared, propios] = await Promise.all([
    listEpisodes(studentId),
    listSharedMaterials(),
    studentId ? listMaterialsVisibleToStudent(studentId) : Promise.resolve([]),
  ]);
  return {
    videos: eps.filter(e => hit(e.title_es, e.title_de, e.topic, ...e.keywords.flatMap(k => [k.de, k.es]))).slice(0, 5)
      .map(e => ({ titulo: e.title_es, nivel: e.level, tema: e.topic, enlace: `/estudiante/videos/${e.slug}` })),
    lecciones: shared.filter(m => hit(m.title, m.subtitle, m.module_name, m.level)).slice(0, 8)
      .map(m => ({ titulo: m.title, nivel: m.level, modulo: m.module_name, enlace: m.gamma_url })),
    del_profesor: propios.filter(m => hit(m.title, m.description, ...m.tags)).slice(0, 5)
      .map(m => ({ titulo: m.title, profesor: m.teacher_name, enlace: m.file_url })),
  };
}

type ClasePasada = { fecha: string; titulo: string; tema: string | null; notas: string | null };

/** Últimas clases dadas. `soloCompartidas`: el alumno solo ve notas que el profe compartió. */
async function clasesPasadas(studentId: string, opts: { soloCompartidas: boolean; teacherId?: string; limite?: number }): Promise<ClasePasada[]> {
  const sb = supabaseAdmin();
  let q = sb
    .from("classes")
    .select("id, title, topic, scheduled_at, teacher_notes, notes_shared_with_student, class_participants!inner(student_id)")
    .eq("class_participants.student_id", studentId)
    .eq("status", "completed")
    .eq("is_trial", false)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false })
    .limit(opts.limite ?? 5);
  if (opts.teacherId) q = q.eq("teacher_id", opts.teacherId);
  const { data } = await q;
  return ((data ?? []) as Array<{ title: string; topic: string | null; scheduled_at: string; teacher_notes: string | null; notes_shared_with_student: boolean }>).map(c => ({
    fecha:  berlinDate(c.scheduled_at),
    titulo: c.title,
    tema:   c.topic,
    notas:  !opts.soloCompartidas || c.notes_shared_with_student ? c.teacher_notes : null,
  }));
}

function tareasDto(items: Awaited<ReturnType<typeof getStudentHomework>>) {
  return items.slice(0, 15).map(h => ({
    titulo:      h.title,
    descripcion: h.description,
    entrega:     h.due_date,
    estado:      !h.submission ? "pendiente" : h.submission.status === "needs_revision" ? "a corregir" : h.submission.status === "submitted" ? "en revisión" : "revisada",
    nota:        h.submission?.grade ?? null,
    comentario:  h.submission?.teacher_feedback ?? null,
  }));
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
      run: async () => ({ clases: (await getStudentUpcomingClasses(ctx.studentId, new Date(), 120)).map(claseDto) }),
    },
    NO_RESUELTO_SPEC,
    {
      spec: {
        name: "repaso_clases",
        description: "Últimas clases dadas del estudiante: fecha, tema y las notas que su profesor compartió. Para «¿qué vimos la última clase?». También indica si tiene documento de apuntes.",
        input_schema: { type: "object", properties: {} },
      },
      input: z.object({}),
      run: async () => {
        const { data } = await supabaseAdmin().from("students").select("document_url").eq("id", ctx.studentId).maybeSingle();
        return {
          clases: await clasesPasadas(ctx.studentId, { soloCompartidas: true }),
          documento_de_apuntes: (data as { document_url: string | null } | null)?.document_url ?? null,
        };
      },
    },
    {
      spec: {
        name: "mis_tareas",
        description: "Tareas del estudiante: pendientes, en revisión y revisadas, con fecha de entrega y comentario del profesor.",
        input_schema: { type: "object", properties: {} },
      },
      input: z.object({}),
      run: async () => ({ tareas: tareasDto(await getStudentHomework(ctx.studentId)), seccion: "/estudiante/tareas" }),
    },
    {
      spec: {
        name: "mis_grabaciones",
        description: "Grabaciones listas de las clases del estudiante, las más recientes primero, con enlace. Opcionalmente de una fecha.",
        input_schema: { type: "object", properties: { fecha: fechaProp } },
      },
      input: z.object({ fecha: Fecha.optional() }),
      run: async (i: { fecha?: string }) => {
        const recs = (await getStudentRecordings(ctx.studentId)).filter(r => r.status === "ready" && (!i.fecha || berlinDate(r.scheduled_at) === i.fecha));
        return { grabaciones: recs.slice(0, 8).map(r => ({ clase: r.class_title, cuando: fmt(r.scheduled_at), enlace: `/grabacion/${r.id}` })) };
      },
    },
    {
      spec: {
        name: "buscar_material",
        description: "Busca material de estudio por palabra: vídeos de la serie, lecciones oficiales por nivel y material de su profesor. Devuelve enlaces. Busca una sola palabra o tema, y prueba en alemán y en español si no aparece.",
        input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
      },
      input: z.object({ texto: z.string().trim().max(80) }),
      run: async (i: { texto: string }) => buscarMaterial(i.texto, ctx.studentId),
    },
    {
      spec: {
        name: "proponer_cancelar",
        description: "Prepara (sin ejecutar) cancelar UNA clase individual del estudiante. Solo hasta 24 h antes; la clase vuelve a su saldo.",
        input_schema: { type: "object", properties: { clase_id: { type: "string", description: "clase_id obtenido de mis_clases." } }, required: ["clase_id"] },
      },
      input: z.object({ clase_id: Uuid }),
      run: async (i: { clase_id: string }, acciones) => {
        const c = await loadClase(i.clase_id);
        if (!c || !c.students.some(s => s.id === ctx.studentId)) return fail("No encuentro esa clase entre las del estudiante.");
        const bad = claseNoEditable(c);
        if (bad) return fail(bad);
        if (c.type !== "individual") return fail("Las clases grupales las gestiona el profesor.");
        if ((new Date(c.scheduled_at).getTime() - Date.now()) / 3_600_000 < RESCHEDULE_CUTOFF_HOURS) {
          return fail(`Solo se puede cancelar hasta ${RESCHEDULE_CUTOFF_HOURS} h antes de la clase. Sugiere escribir al profesor por Mensajes.`);
        }
        const de = ctx.lang === "de";
        return propuesta(acciones, {
          tipo:   "cancelar",
          titulo: de ? "Stunde absagen" : "Cancelar clase",
          lineas: [fmt(c.scheduled_at), c.title],
          nota:   de ? "Die Stunde geht zurück auf dein Guthaben. Deine Lehrkraft wird benachrichtigt." : "La clase vuelve a tu saldo. Tu profesor recibirá una notificación.",
          request: { method: "DELETE", url: `/api/student/schedule/${c.id}`, body: null },
        });
      },
    },
    {
      spec: moverSpec("Para cambiar el horario fijo del estudiante. Reglas: solo clases individuales suyas, con más de 24 h de margen, y a huecos libres de su profesor."),
      input: MoverInput,
      run: async (i: z.infer<typeof MoverInput>, acciones) => propuestaMover(
        { role: "student", studentId: ctx.studentId }, i, acciones,
        ctx.lang === "de" ? "Deine Lehrkraft wird einmal benachrichtigt." : "Tu profesor recibirá una sola notificación.", ctx.lang,
      ),
    },
    {
      spec: {
        name: "proponer_mensaje",
        description: "Prepara (sin enviar) un mensaje al profesor del estudiante por el chat de la plataforma. Muestra el texto exacto en la tarjeta. Si el usuario no dictó el texto, redáctalo breve y fiel a lo que pidió.",
        input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
      },
      input: z.object({ texto: z.string().trim().min(1).max(2000) }),
      run: async (i: { texto: string }, acciones) => {
        const teacher = await resolveStudentTeacher(ctx.studentId);
        if (!teacher) return fail("El estudiante aún no tiene profesor asignado.");
        const chatId = await directChat(ctx.userId, teacher.teacherUserId);
        if (!chatId) return fail("Aún no hay un chat abierto con su profesor. Se abre al agendar la primera clase; mientras, que escriba a la academia.");
        return propuestaMensaje(acciones, chatId, teacher.teacherName, i.texto, ctx.lang);
      },
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

  const actor: Actor = ctx.role === "teacher" ? { role: "teacher", teacherId: ctx.teacherId } : { role: "admin" };

  if (ctx.role === "teacher") {
    const teacherId = ctx.teacherId;
    tools.push(
      {
        spec: {
          name: "mis_ganancias",
          description: "Ganancias del profesor por mes (últimos 6): clases, horas, importe y si está pagado. Es lo mismo que ve en «Ganancias»; ajustes de nómina pueden no estar reflejados.",
          input_schema: { type: "object", properties: {} },
        },
        input: z.object({}),
        run: async () => ({
          meses: (await getTeacherEarningsSummary(teacherId, 6)).map(m => ({
            mes: m.month.slice(0, 7), clases: m.classes_count, horas: Math.round(m.total_minutes / 6) / 10,
            importe: `${(m.amount_cents / 100).toFixed(2)} ${m.currency}`, pagado: m.paid,
          })),
          seccion: "/profesor/ganancias",
        }),
      },
      {
        spec: {
          name: "mis_grabaciones",
          description: "Grabaciones listas de las clases del profesor (sin clases de prueba), las más recientes primero, con enlace.",
          input_schema: { type: "object", properties: {} },
        },
        input: z.object({}),
        run: async () => {
          const recs = (await getTeacherRecordings(teacherId)).filter(r => r.status === "ready" && !r.is_trial);
          return { grabaciones: recs.slice(0, 8).map(r => ({ clase: r.class_title, cuando: fmt(r.scheduled_at), enlace: `/grabacion/${r.id}` })) };
        },
      },
      {
        spec: {
          name: "proponer_mensaje",
          description: "Prepara (sin enviar) un mensaje a un estudiante del profesor por el chat de la plataforma. Muestra el texto exacto en la tarjeta. Si el usuario no dictó el texto, redáctalo breve y fiel a lo que pidió.",
          input_schema: { type: "object", properties: { estudiante_id: estudianteProp, texto: { type: "string" } }, required: ["estudiante_id", "texto"] },
        },
        input: z.object({ estudiante_id: Uuid, texto: z.string().trim().min(1).max(2000) }),
        run: async (i: { estudiante_id: string; texto: string }, acciones) => {
          const s = (await teacherStudents(teacherId)).find(x => x.id === i.estudiante_id);
          if (!s) return fail("Ese estudiante no está entre los del profesor.");
          const { data } = await sb.from("students").select("user_id").eq("id", s.id).maybeSingle();
          const chatId = await directChat(ctx.userId, (data as { user_id: string }).user_id);
          if (!chatId) return fail("Aún no hay un chat directo con ese estudiante: se abre al agendar una clase individual. Puede escribirle desde «Mensajes» si es por grupo.");
          return propuestaMensaje(acciones, chatId, s.name, i.texto);
        },
      },
    );
  }

  tools.push(
    NO_RESUELTO_SPEC,
    {
      spec: {
        name: "preparar_clase",
        description: "Resumen para preparar la clase con un estudiante: nivel y meta, últimas clases con tema y notas, tareas, saldo y próxima clase.",
        input_schema: { type: "object", properties: { estudiante_id: estudianteProp }, required: ["estudiante_id"] },
      },
      input: z.object({ estudiante_id: Uuid }),
      run: async (i: { estudiante_id: string }) => {
        const s = await resolveStudent(i.estudiante_id);
        if (typeof s === "string") return fail(s);
        const teacherId = ctx.role === "teacher" ? ctx.teacherId : undefined;
        const [perfil, pasadas, tareas, saldo, proximas] = await Promise.all([
          sb.from("students").select("current_level, goal, document_url").eq("id", s.id).maybeSingle(),
          clasesPasadas(s.id, { soloCompartidas: false, teacherId }),
          getStudentHomework(s.id),
          saldoDto(s.id),
          getStudentUpcomingClasses(s.id),
        ]);
        const p = perfil.data as { current_level: string | null; goal: string | null; document_url: string | null } | null;
        const prox = proximas.find(c => !teacherId || c.teacher_id === teacherId);
        return {
          estudiante: s.name, nivel: p?.current_level ?? null, meta: p?.goal ?? null, documento_de_apuntes: p?.document_url ?? null,
          ultimas_clases: pasadas, tareas: tareasDto(tareas), saldo, proxima_clase: prox ? fmt(prox.scheduled_at) : null,
        };
      },
    },
    {
      spec: {
        name: "buscar_material",
        description: "Busca material oficial de la academia por palabra: vídeos de la serie y lecciones por nivel. Devuelve enlaces. Busca una sola palabra o tema.",
        input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
      },
      input: z.object({ texto: z.string().trim().max(80) }),
      run: async (i: { texto: string }) => {
        const r = await buscarMaterial(i.texto, null);
        return { videos: r.videos.map(v => ({ ...v, enlace: v.enlace.replace("/estudiante/", isAdmin ? "/admin/" : "/profesor/") })), lecciones: r.lecciones };
      },
    },
    {
      spec: moverSpec("Para cambiar el horario de muchas clases sueltas de un estudiante. Comprueba solapes con otras clases del profesor."),
      input: MoverInput,
      run: async (i: z.infer<typeof MoverInput>, acciones) => propuestaMover(actor, i, acciones,
        isAdmin ? "Desde el panel de admin este cambio NO avisa al estudiante ni al profesor." : "El estudiante recibirá un solo email y notificación con el resumen."),
    },
    {
      spec: {
        name: "proponer_bloqueo",
        description: "Prepara (sin ejecutar) una excepción puntual de disponibilidad: «bloqueo» (esa franja no está disponible esa fecha) o «apertura» (abrirla solo esa fecha). No cancela clases ya agendadas: si hay alguna en esa franja, se avisa.",
        input_schema: {
          type: "object",
          properties: {
            ...(isAdmin ? { profesor_id: profesorProp } : {}),
            fecha: fechaProp,
            hora_inicio: { type: "string", description: "HH:MM en Berlín." },
            hora_fin: { type: "string", description: "HH:MM en Berlín." },
            tipo: { type: "string", enum: ["bloqueo", "apertura"], description: "Por defecto «bloqueo»." },
            motivo: { type: "string" },
          },
          required: [...(isAdmin ? ["profesor_id"] : []), "fecha", "hora_inicio", "hora_fin"],
        },
      },
      input: z.object({
        profesor_id: Uuid.optional(), fecha: Fecha, hora_inicio: Hora, hora_fin: Hora,
        tipo: z.enum(["bloqueo", "apertura"]).optional(), motivo: z.string().trim().max(200).optional(),
      }),
      run: async (i: { profesor_id?: string; fecha: string; hora_inicio: string; hora_fin: string; tipo?: "bloqueo" | "apertura"; motivo?: string }, acciones) => {
        const t = await resolveTeacher(i.profesor_id);
        if (typeof t === "string") return fail(t);
        if (i.hora_fin <= i.hora_inicio) return fail("La hora de fin debe ser posterior a la de inicio.");
        if (i.fecha < berlinDate(new Date())) return fail("Esa fecha ya pasó.");
        const kind = i.tipo ?? "bloqueo";
        const startIso = berlinToIso(i.fecha, i.hora_inicio);
        const minutes = Math.round((new Date(berlinToIso(i.fecha, i.hora_fin)).getTime() - new Date(startIso).getTime()) / 60_000);
        const pisadas = kind === "bloqueo"
          ? await findTeacherConflicts(sb, { teacherId: t.id, startIso, durationMinutes: minutes, breakMinutes: 0 })
          : [];
        return propuesta(acciones, {
          tipo:   "bloquear",
          titulo: kind === "bloqueo" ? "Bloquear disponibilidad" : "Abrir disponibilidad",
          lineas: [`${formatClassDateEs(`${i.fecha}T12:00:00Z`)} · ${i.hora_inicio}–${i.hora_fin} (hora de Berlín)`, ...(isAdmin ? [`Prof. ${t.name}`] : []), ...(i.motivo ? [i.motivo] : [])],
          nota:   pisadas.length > 0
            ? `Ojo: hay ${pisadas.length} ${pisadas.length === 1 ? "clase agendada" : "clases agendadas"} en esa franja (${fmt(pisadas[0].scheduled_at)}) y NO se cancelan.`
            : "Solo afecta a los huecos nuevos que se ofrecen; nadie recibe aviso.",
          hecho:  kind === "bloqueo" ? "Franja bloqueada" : "Franja abierta",
          request: {
            method: "POST",
            url: `/api/teacher/availability/exceptions${isAdmin ? `?teacherId=${t.id}` : ""}`,
            body: { date: i.fecha, start_time: i.hora_inicio, end_time: i.hora_fin, kind, ...(i.motivo ? { reason: i.motivo } : {}) },
          },
        });
      },
    },
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
