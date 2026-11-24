import { supabaseAdmin } from "./supabase";

/**
 * "Leads Urgentes" del setter (Gelfis 2026-11-22): todas las citas de
 * HOY y MAÑANA (día de Berlín), confirmadas o no, con la fecha del
 * último contacto del setter bien visible. Objetivo: si el último toque
 * fue hace muchos días —aunque hubiera confirmado—, darle un toque más
 * antes de la clase.
 *
 * A diferencia de la cola, aquí NO se excluyen los confirmados ni los
 * snoozeados: es la foto completa del día. Solo quedan fuera
 * convertidos, perdidos y citas canceladas.
 */

export type UrgenteItem = {
  leadId: string;
  classId: string;
  citaTipo: "trial" | "sesion";
  citaAt: string;
  hostName: string | null;
  confirmada: boolean;
  lead: {
    name: string | null;
    phone: string | null;
    germanLevel: string | null;
  };
  /** Último contacto del setter (cualquier acción), null si nunca. */
  lastContact: { occurred_at: string; action_type: string } | null;
  /** Días completos desde el último contacto (null si nunca). */
  daysSinceContact: number | null;
  /** Cuándo se agendó la cita (para "agendó hace X" en calientes). */
  bookedAt: string;
};

export type SetterUrgentes = {
  hoy: UrgenteItem[];
  manana: UrgenteItem[];
  /** 🔥 Recién agendados sin NINGÚN contacto del setter desde la agenda
   *  (speed-to-lead, Gelfis 2026-11-24): cita futura, el más fresco
   *  primero. Puede solaparse con hoy/mañana — a propósito. */
  calientes: UrgenteItem[];
};

const D = 86_400_000;
const T = (iso: string) => new Date(iso).getTime();

/** Día YYYY-MM-DD en hora de Berlín. */
function berlinDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

export async function getSetterUrgentes(now = Date.now()): Promise<SetterUrgentes> {
  const sb = supabaseAdmin();

  const todayKey = berlinDay(new Date(now));
  const tomorrowKey = berlinDay(new Date(now + D));

  // Ventana ayer→+30 días: hoy/mañana se bucketizan por día de Berlín y
  // las citas más lejanas solo alimentan "calientes" (recién agendados).
  const { data: classesData } = await sb
    .from("classes")
    .select("id, lead_id, scheduled_at, status, is_trial, sesion_closer_id, teacher_id, created_at, notify_after_at")
    .not("lead_id", "is", null)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .is("deleted_at", null)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date(now - D).toISOString())
    .lte("scheduled_at", new Date(now + 30 * D).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(500);

  type ClassRow = {
    id: string; lead_id: string; scheduled_at: string; status: string;
    is_trial: boolean; sesion_closer_id: string | null; teacher_id: string | null;
    created_at: string; notify_after_at: string | null;
  };
  const classes = (classesData ?? []) as ClassRow[];
  if (classes.length === 0) return { hoy: [], manana: [], calientes: [] };

  const leadIds = [...new Set(classes.map(c => c.lead_id))];

  const [leadsRes, contactsRes] = await Promise.all([
    sb.from("leads")
      .select("id, name, whatsapp_normalized, whatsapp_raw, german_level, status, estado_cierre")
      .in("id", leadIds),
    sb.from("lead_contacts")
      .select("lead_id, action_type, occurred_at")
      .eq("actor_type", "setter")
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: true })
      .limit(2000),
  ]);

  type LeadRow = {
    id: string; name: string | null; whatsapp_normalized: string | null;
    whatsapp_raw: string | null; german_level: string | null;
    status: string; estado_cierre: string | null;
  };
  const leadById = new Map<string, LeadRow>();
  for (const l of (leadsRes.data ?? []) as LeadRow[]) leadById.set(l.id, l);

  type ContactRow = { lead_id: string; action_type: string; occurred_at: string };
  const contactsByLead = new Map<string, ContactRow[]>();
  for (const c of (contactsRes.data ?? []) as ContactRow[]) {
    const arr = contactsByLead.get(c.lead_id) ?? [];
    arr.push(c);
    contactsByLead.set(c.lead_id, arr);
  }

  // Nombres de anfitrión (mismo patrón que la cola).
  const teacherIds = [...new Set(classes.map(c => c.teacher_id).filter((x): x is string => !!x))];
  const closerIds = [...new Set(classes.map(c => c.sesion_closer_id).filter((x): x is string => !!x))];
  const teacherUserByTeacherId = new Map<string, string>();
  if (teacherIds.length > 0) {
    const { data } = await sb.from("teachers").select("id, user_id").in("id", teacherIds);
    for (const t of (data ?? []) as Array<{ id: string; user_id: string }>) {
      teacherUserByTeacherId.set(t.id, t.user_id);
    }
  }
  const hostUserIds = [...new Set([...closerIds, ...teacherUserByTeacherId.values()])];
  const nameByUserId = new Map<string, string>();
  if (hostUserIds.length > 0) {
    const { data } = await sb.from("users").select("id, full_name").in("id", hostUserIds);
    for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (u.full_name) nameByUserId.set(u.id, u.full_name);
    }
  }

  const hoy: UrgenteItem[] = [];
  const manana: UrgenteItem[] = [];
  const calientes: UrgenteItem[] = [];

  for (const cls of classes) {
    const lead = leadById.get(cls.lead_id);
    if (!lead) continue;
    if (lead.status === "converted" || lead.estado_cierre === "convertido") continue;
    if (lead.status === "lost" || lead.status === "not_qualified" || lead.estado_cierre === "perdido") continue;

    const contacts = contactsByLead.get(cls.lead_id) ?? [];
    const last = contacts[contacts.length - 1] ?? null;
    const bookedAt = cls.notify_after_at ?? cls.created_at;
    const confirmada = contacts.some(c =>
      c.action_type === "confirmar_cita" && T(c.occurred_at) > T(bookedAt));

    const hostUserId = cls.sesion_closer_id ?? (cls.teacher_id ? teacherUserByTeacherId.get(cls.teacher_id) ?? null : null);

    const item: UrgenteItem = {
      leadId: cls.lead_id,
      classId: cls.id,
      citaTipo: cls.sesion_closer_id ? "sesion" : "trial",
      citaAt: cls.scheduled_at,
      hostName: hostUserId ? nameByUserId.get(hostUserId) ?? null : null,
      confirmada,
      lead: {
        name: lead.name,
        phone: lead.whatsapp_normalized ?? lead.whatsapp_raw,
        germanLevel: lead.german_level,
      },
      lastContact: last ? { occurred_at: last.occurred_at, action_type: last.action_type } : null,
      daysSinceContact: last ? Math.floor((now - T(last.occurred_at)) / D) : null,
      bookedAt,
    };

    const day = berlinDay(new Date(cls.scheduled_at));
    if (day === todayKey) hoy.push(item);
    else if (day === tomorrowKey) manana.push(item);

    // 🔥 Caliente: cita futura y CERO contactos del setter desde que se
    // agendó — llamar ya (speed-to-lead). Se solapa con hoy/mañana.
    const tocadoTrasAgendar = contacts.some(c => T(c.occurred_at) > T(bookedAt));
    if (T(cls.scheduled_at) > now && !tocadoTrasAgendar) calientes.push(item);
  }

  // El agendado más reciente primero: es al que hay que llamar YA.
  calientes.sort((a, b) => T(b.bookedAt) - T(a.bookedAt));

  return { hoy, manana, calientes };
}
