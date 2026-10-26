/**
 * Cola del setter (Gelfis 2026-10-24, v2). 100% derivada de datos
 * existentes (classes + leads + lead_contacts) — sin estado propio en BD.
 *
 * Dos listas:
 *   pendiente — citas FUTURAS sin "confirmo" registrado. El setter llama
 *               lo antes posible buscando el CONFIRMO. Orden: la cita
 *               más próxima primero.
 *   no_show   — no asistieron (marcados, o "sin marcar" >2h tras la hora
 *               de la cita, ventana 45 días). El setter recupera la
 *               agenda enviándoles el enlace de reagenda vía Stiv.
 *
 * Reglas:
 *   · "Confirmado" (contacto confirmar_cita posterior al agendado) saca
 *     al lead de pendientes.
 *   · "No contestó" lo pone en espera: vuelve a aparecer a las 24h del
 *     intento o 2 horas antes de su clase, lo que llegue primero.
 *   · Excluidos siempre: asistidos, convertidos, perdidos.
 */

import { supabaseAdmin } from "./supabase";

const H = 3_600_000;
const D = 24 * H;

export const BACKLOG_MAX_DIAS = 45;
/** Una cita pasada sin marcar entra a la cola a las 2h (no se auto-marca). */
export const SIN_MARCAR_DELAY_MS = 2 * H;
/** "No contestó": en espera 24h… */
export const NO_CONTESTO_SNOOZE_MS = 24 * H;
/** …o hasta 2h antes de su clase, lo que llegue primero. */
export const NO_CONTESTO_PRECLASE_MS = 2 * H;
/** Lote de no-shows visible a la vez: el setter los trabaja poco a poco
 *  sin abrumarse (Gelfis 2026-10-26). Al trabajar uno (confirmo,
 *  reagenda o "no contestó"), entra el siguiente del backlog solo. */
export const NO_SHOW_BATCH = 15;

export type SetterTramo = "pendiente" | "no_show";

export type SetterQueueItem = {
  tramo: SetterTramo;
  leadId: string;
  classId: string;
  citaTipo: "trial" | "sesion";
  citaAt: string;
  /** Nombre del profe (trial) o closer (sesión) anfitrión, si se resolvió. */
  hostName: string | null;
  /** Q no_show: cuándo se marcó el no-show (null en los "sin marcar"). */
  noShowAt: string | null;
  /** Cita pasada que nadie marcó — el setter la ve igual (regla 2h). */
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

export type SetterQueue = {
  items: SetterQueueItem[];
  /** Leads en espera tras "no contestó" (vuelven solos a la lista). */
  snoozed: { pendientes: number; noShows: number };
  /** No-shows más allá del lote visible — entran solos al trabajar el lote. */
  noShowBacklog: number;
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

export async function getSetterQueue(now = Date.now()): Promise<SetterQueue> {
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
  if (classes.length === 0) return { items: [], snoozed: { pendientes: 0, noShows: 0 }, noShowBacklog: 0 };

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

  const items: SetterQueueItem[] = [];
  const snoozed = { pendientes: 0, noShows: 0 };

  /** En espera por "no contestó": el ÚLTIMO contacto del setter fue
   *  no_contesto y aún no toca reintentar. */
  const isSnoozed = (contacts: SetterContactRow[], citaMs: number | null): boolean => {
    const last = contacts[contacts.length - 1];
    if (!last || last.action_type !== "no_contesto") return false;
    const retryAt = Math.min(
      T(last.occurred_at) + NO_CONTESTO_SNOOZE_MS,
      citaMs != null && citaMs > now ? citaMs - NO_CONTESTO_PRECLASE_MS : Infinity,
    );
    return now < retryAt;
  };

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

    const base = {
      leadId: cls.lead_id,
      classId: cls.id,
      citaTipo,
      citaAt: cls.scheduled_at,
      hostName,
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

    // ── Citas FUTURAS → pendientes de CONFIRMO ──
    if (cls.status === "scheduled" && citaMs > now) {
      const confirmada = setterContacts.some(c =>
        c.action_type === "confirmar_cita" && T(c.occurred_at) > T(bookedAt));
      if (confirmada) continue;   // ✅ confirmado → fuera de su lista

      if (isSnoozed(setterContacts, citaMs)) {
        snoozed.pendientes++;
        continue;
      }
      items.push({ ...base, tramo: "pendiente", noShowAt: null, sinMarcar: false });
      continue;
    }

    // ── Citas PASADAS → no asistieron (recuperar) ──
    const tieneCitaFutura =
      (lead.trial_scheduled_at && T(lead.trial_scheduled_at) > now) ||
      (lead.sesion_plan_at && T(lead.sesion_plan_at) > now);
    if (tieneCitaFutura) continue;   // ya reagendó — rescate hecho

    if (cls.status === "cancelled") continue;

    let noShowAt: string | null = null;
    let sinMarcar = false;

    if (lead.trial_absent_at) {
      noShowAt = lead.trial_absent_at;
    } else if (cls.status === "scheduled" && now - citaMs > SIN_MARCAR_DELAY_MS) {
      // Cita pasada que nadie marcó — el setter la VE y llama igual
      // (nada cambia en la cita; política no-auto-cancel intacta).
      sinMarcar = true;
    } else {
      continue;
    }

    const refMs = noShowAt ? T(noShowAt) : citaMs;
    if ((now - refMs) / D > BACKLOG_MAX_DIAS) continue;

    if (isSnoozed(setterContacts, null)) {
      snoozed.noShows++;
      continue;
    }

    items.push({ ...base, tramo: "no_show", noShowAt, sinMarcar });
  }

  // Dedupe no_show por lead (trial Y sesión pasadas = una sola fila).
  const seenRescate = new Set<string>();
  const deduped = items.filter(it => {
    if (it.tramo !== "no_show") return true;
    if (seenRescate.has(it.leadId)) return false;
    seenRescate.add(it.leadId);
    return true;
  });

  // Orden: pendientes por cita más próxima (urgencia del confirmo);
  // no-shows con el más fresco primero (más rescatable).
  deduped.sort((a, b) => {
    if (a.tramo !== b.tramo) return a.tramo === "pendiente" ? -1 : 1;
    if (a.tramo === "pendiente") return T(a.citaAt) - T(b.citaAt);
    const aRef = a.noShowAt ?? a.citaAt;
    const bRef = b.noShowAt ?? b.citaAt;
    return T(bRef) - T(aRef);
  });

  // Lote: solo los NO_SHOW_BATCH no-shows más recientes a la vista; el
  // resto queda en backlog y entra solo a medida que se trabaja el lote.
  const pendientesAll = deduped.filter(it => it.tramo === "pendiente");
  const noShowsAll = deduped.filter(it => it.tramo === "no_show");
  const noShowBacklog = Math.max(0, noShowsAll.length - NO_SHOW_BATCH);

  return {
    items: [...pendientesAll, ...noShowsAll.slice(0, NO_SHOW_BATCH)],
    snoozed,
    noShowBacklog,
  };
}
