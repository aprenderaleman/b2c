/**
 * Cola del setter (Gelfis 2026-08-31). 100% derivada de datos existentes
 * (classes + leads + lead_contacts) — sin estado propio en BD.
 *
 * Tramos:
 *   Q1 sin_confirmar  — citas futuras sin llamada de confirmación del
 *                       setter posterior al (re)agendado.
 *   Q2 hoy_manana     — citas de hoy/mañana (Berlín) sin recordatorio
 *                       (cuenta cualquier toque del setter desde el día
 *                       anterior a la cita).
 *   Q3 no_show_7d     — no-shows de los últimos 7 días sin cita futura.
 *                       Incluye citas pasadas SIN MARCAR (>2h desde la
 *                       hora de la cita) con etiqueta "sin marcar" — no
 *                       es auto-marcado: la cita no se toca, solo se ve.
 *   Q4 backlog        — igual que Q3, de 7 a 45 días.
 *
 * Excluidos siempre: asistidos (territorio del closer), convertidos,
 * perdidos/no cualificados.
 */

import { supabaseAdmin } from "./supabase";
import { berlinDateKey } from "./semaforo";
import { berlinClockToUtcMs } from "./trial-slots";

const H = 3_600_000;
const D = 24 * H;

export const NO_SHOW_RECIENTE_DIAS = 7;
export const BACKLOG_MAX_DIAS = 45;
/** Ajuste B: una cita pasada sin marcar entra a la cola a las 2h. */
export const SIN_MARCAR_DELAY_MS = 2 * H;

export type SetterTramo = "sin_confirmar" | "hoy_manana" | "no_show_7d" | "backlog";

export type SetterQueueItem = {
  tramo: SetterTramo;
  leadId: string;
  classId: string;
  /** trial | sesion */
  citaTipo: "trial" | "sesion";
  citaAt: string;
  /** Nombre del profe (trial) o closer (sesión) anfitrión, si se resolvió. */
  hostName: string | null;
  /** Momento del (re)agendado — notify_after_at se resetea en cada booking. */
  bookedAt: string;
  /** Q3/Q4: cuándo se marcó el no-show (null en los "sin marcar"). */
  noShowAt: string | null;
  /** Ajuste B: cita pasada que nadie marcó — el setter la ve igual. */
  sinMarcar: boolean;
  lead: {
    name: string | null;
    phone: string | null;
    email: string | null;
    goal: string | null;
    motivoInicial: string | null;
    germanLevel: string | null;
  };
  /** Último contacto del setter con este lead (para la fila de la cola). */
  lastSetterContact: { occurred_at: string; action_type: string; actor_name: string | null } | null;
};

type ClassRow = {
  id: string;
  lead_id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  is_trial: boolean;
  sesion_closer_id: string | null;
  teacher_id: string | null;
  created_at: string;
  notify_after_at: string | null;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  whatsapp_raw: string | null;
  german_level: string | null;
  goal: string | null;
  motivo_inicial: string | null;
  status: string;
  estado_cierre: string | null;
  trial_scheduled_at: string | null;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
  sesion_plan_at: string | null;
};

type SetterContactRow = {
  lead_id: string;
  action_type: string;
  occurred_at: string;
  actor_name: string | null;
};

const T = (iso: string) => new Date(iso).getTime();

/** 00:00 Berlín del día (offset en días respecto a `ms`). */
function berlinDayStartMs(ms: number, dayOffset = 0): number {
  return berlinClockToUtcMs(new Date(ms + dayOffset * D), "00:00:00");
}

export async function getSetterQueue(now = Date.now()): Promise<SetterQueueItem[]> {
  const sb = supabaseAdmin();

  const fromIso = new Date(now - BACKLOG_MAX_DIAS * D).toISOString();
  const toIso = new Date(now + 14 * D).toISOString();

  // 1) Universo: citas de leads (trial o sesión de plan) en la ventana.
  const { data: classesData } = await sb
    .from("classes")
    .select("id, lead_id, scheduled_at, duration_minutes, status, is_trial, sesion_closer_id, teacher_id, created_at, notify_after_at")
    .not("lead_id", "is", null)
    .or("is_trial.eq.true,sesion_closer_id.not.is.null")
    .is("deleted_at", null)
    .gte("scheduled_at", fromIso)
    .lte("scheduled_at", toIso)
    .order("scheduled_at", { ascending: true })
    .limit(2000);

  const classes = (classesData ?? []) as ClassRow[];
  if (classes.length === 0) return [];

  const leadIds = [...new Set(classes.map(c => c.lead_id))];

  const [leadsRes, contactsRes] = await Promise.all([
    sb.from("leads")
      .select("id, name, email, whatsapp_normalized, whatsapp_raw, german_level, goal, motivo_inicial, status, estado_cierre, trial_scheduled_at, trial_attended_at, trial_absent_at, sesion_plan_at")
      .in("id", leadIds),
    sb.from("lead_contacts")
      .select("lead_id, action_type, occurred_at, actor_name")
      .eq("actor_type", "setter")
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: true })
      .limit(4000),
  ]);

  const leadById = new Map<string, LeadRow>();
  for (const l of (leadsRes.data ?? []) as LeadRow[]) leadById.set(l.id, l);

  const setterContactsByLead = new Map<string, SetterContactRow[]>();
  for (const c of (contactsRes.data ?? []) as SetterContactRow[]) {
    const arr = setterContactsByLead.get(c.lead_id) ?? [];
    arr.push(c);
    setterContactsByLead.set(c.lead_id, arr);
  }

  // 2) Nombres de anfitrión (profe via teachers→users, closer via users).
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

  const hoyKey = berlinDateKey(now);
  const mananaKey = berlinDateKey(now + D);

  const items: SetterQueueItem[] = [];

  for (const cls of classes) {
    const lead = leadById.get(cls.lead_id);
    if (!lead) continue;

    // Exclusiones globales: asistidos, convertidos, perdidos.
    if (lead.trial_attended_at) continue;
    if (lead.status === "converted" || lead.estado_cierre === "convertido") continue;
    if (lead.status === "lost" || lead.status === "not_qualified" || lead.estado_cierre === "perdido") continue;

    const setterContacts = setterContactsByLead.get(cls.lead_id) ?? [];
    const lastSetterContact = setterContacts[setterContacts.length - 1] ?? null;

    const citaTipo: "trial" | "sesion" = cls.sesion_closer_id ? "sesion" : "trial";
    const hostUserId = cls.sesion_closer_id ?? (cls.teacher_id ? teacherUserByTeacherId.get(cls.teacher_id) ?? null : null);
    const hostName = hostUserId ? nameByUserId.get(hostUserId) ?? null : null;
    const bookedAt = cls.notify_after_at ?? cls.created_at;
    const citaMs = T(cls.scheduled_at);
    const citaKey = berlinDateKey(citaMs);

    const base = {
      leadId: cls.lead_id,
      classId: cls.id,
      citaTipo,
      citaAt: cls.scheduled_at,
      hostName,
      bookedAt,
      lead: {
        name: lead.name,
        phone: lead.whatsapp_normalized ?? lead.whatsapp_raw,
        email: lead.email,
        goal: lead.goal,
        motivoInicial: lead.motivo_inicial,
        germanLevel: lead.german_level,
      },
      lastSetterContact,
    };

    // ── Citas FUTURAS agendadas → Q1 / Q2 ──
    if (cls.status === "scheduled" && citaMs > now) {
      const confirmada = setterContacts.some(c =>
        c.action_type === "confirmar_cita" && T(c.occurred_at) > T(bookedAt));

      if (!confirmada) {
        items.push({ ...base, tramo: "sin_confirmar", noShowAt: null, sinMarcar: false });
        continue;
      }

      if (citaKey === hoyKey || citaKey === mananaKey) {
        // Recordatorio hecho = cualquier toque del setter desde las 00:00
        // Berlín del día ANTERIOR a la cita.
        const desdeMs = berlinDayStartMs(citaMs, -1);
        const recordada = setterContacts.some(c =>
          (c.action_type === "recordatorio_cita" || c.action_type === "confirmar_cita") &&
          T(c.occurred_at) >= desdeMs);
        if (!recordada) {
          items.push({ ...base, tramo: "hoy_manana", noShowAt: null, sinMarcar: false });
        }
      }
      continue;
    }

    // ── Citas PASADAS → Q3 / Q4 (no-show marcado o "sin marcar") ──
    // El lead ya está filtrado: no asistió, no convirtió, no está perdido.
    // Si tiene cita futura, el rescate ya ocurrió → fuera de Q3/Q4.
    const tieneCitaFutura =
      (lead.trial_scheduled_at && T(lead.trial_scheduled_at) > now) ||
      (lead.sesion_plan_at && T(lead.sesion_plan_at) > now);
    if (tieneCitaFutura) continue;

    if (cls.status === "cancelled") continue;   // canceladas: rescate vía chain6, fuera del MVP

    let noShowAt: string | null = null;
    let sinMarcar = false;

    if (lead.trial_absent_at) {
      noShowAt = lead.trial_absent_at;
    } else if (cls.status === "scheduled" && now - citaMs > SIN_MARCAR_DELAY_MS) {
      // Ajuste B: cita pasada que nadie marcó — el setter la VE y llama.
      // Nada cambia en la cita (política no-auto-cancel intacta).
      sinMarcar = true;
    } else {
      continue;
    }

    const refMs = noShowAt ? T(noShowAt) : citaMs;
    const edadDias = (now - refMs) / D;
    if (edadDias > BACKLOG_MAX_DIAS) continue;

    items.push({
      ...base,
      tramo: edadDias <= NO_SHOW_RECIENTE_DIAS ? "no_show_7d" : "backlog",
      noShowAt,
      sinMarcar,
    });
  }

  // Dedupe Q3/Q4 por lead (un lead con trial Y sesión pasadas = una sola
  // fila de rescate, la más reciente).
  const seenRescate = new Set<string>();
  const deduped = items.filter(it => {
    if (it.tramo !== "no_show_7d" && it.tramo !== "backlog") return true;
    if (seenRescate.has(it.leadId)) return false;
    seenRescate.add(it.leadId);
    return true;
  });

  // Orden: Q1 por antigüedad del agendado (el que espera más, primero) ·
  // Q2 por hora de cita · Q3/Q4 el no-show más fresco primero (más
  // rescatable).
  const TRAMO_RANK: Record<SetterTramo, number> = {
    sin_confirmar: 0, hoy_manana: 1, no_show_7d: 2, backlog: 3,
  };
  deduped.sort((a, b) => {
    const r = TRAMO_RANK[a.tramo] - TRAMO_RANK[b.tramo];
    if (r !== 0) return r;
    if (a.tramo === "hoy_manana") return T(a.citaAt) - T(b.citaAt);
    if (a.tramo === "sin_confirmar") return T(a.bookedAt) - T(b.bookedAt);
    const aRef = a.noShowAt ?? a.citaAt;
    const bRef = b.noShowAt ?? b.citaAt;
    return T(bRef) - T(aRef);
  });

  return deduped;
}
