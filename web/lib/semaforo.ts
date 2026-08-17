/**
 * Semáforo GLOBAL del lead (fase 2 del sistema de estados, Gelfis
 * 2026-08-16). Sustituye el cálculo del semáforo del closer y lo
 * generaliza para closer + profesor + admin.
 *
 * Principio rector: el color NO mide el interés del lead — mide
 * NUESTRA DEUDA con él ("¿le debemos una acción, y desde cuándo?").
 * Se calcula on-read desde registros (lead_contacts, tareas_closer,
 * lead_chains, ventas, leads). NUNCA se persiste como columna editable
 * ni existe UI para cambiarlo.
 *
 * Ventana hábil 08:00–22:00 Europe/Berlin: los relojes de horas (2h,
 * 3h, 30min) SOLO corren dentro de la ventana. Un mensaje a las 23:30
 * empieza a contar a las 08:00 del día siguiente (check C5).
 *
 * Reglas (spec sección 3):
 *   🔴 R1 inbound sin saliente posterior >2h hábiles
 *      R2 tarea con due < hoy sin completar
 *      R3 enlace de pago >3h hábiles sin pago ni saliente posterior
 *      R4 lead nuevo >30min hábiles sin NINGÚN saliente (humano o Stiv)
 *      R5 asistió (trial/sesión) >2h hábiles sin propuesta NI tarea futura
 *   🟡 A1 tarea vence hoy · A2 trial/sesión HOY · A3 enlace <3h sin pagar
 *   🟢 V1 tarea futura o cadena activa · V2 convertido 💰 · V3 en_reactivacion
 *   ⚫ fuera = perdido/no cualificado (archivado, sin color)
 *
 * Orden de cola dentro del rojo: 💰 → 💬 → 🆕 → 🎓 → 📅, y dentro de
 * cada tipo por antigüedad desc (el disparador más viejo primero).
 */

import { supabaseAdmin } from "./supabase";
import { berlinClockToUtcMs } from "./trial-slots";

// ── Ventana hábil (configurable por env) ─────────────────────────────
const HABIL_START = Number(process.env.SEMAFORO_HABIL_START ?? 8);   // 08:00 Berlín
const HABIL_END   = Number(process.env.SEMAFORO_HABIL_END   ?? 22);  // 22:00 Berlín

const MIN = 60_000;
const H = 3_600_000;
const D = 24 * H;

const UMBRAL_RESPUESTA_MS = 2 * H;        // R1
const UMBRAL_ENLACE_MS    = 3 * H;        // R3 / A3
const UMBRAL_NUEVO_MS     = 30 * MIN;     // R4
const UMBRAL_POSTCLASE_MS = 2 * H;        // R5
export const AUTO_SEGUIMIENTO_DIAS = 3;   // anti-limbo

/**
 * Epoch del semáforo (check C6): los disparadores ANTERIORES al
 * arranque del sistema no generan rojo — la deuda histórica no se
 * puede atender retroactivamente y un muro de rojos falsos el día 1
 * mata la credibilidad. El reloj de la deuda empieza aquí.
 */
export const SEMAFORO_EPOCH_MS = new Date(
  process.env.SEMAFORO_EPOCH ?? "2026-08-17T00:00:00+02:00",
).getTime();

const berlinDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
});

/** "2026-08-16" del instante dado, en el calendario de Berlín. */
export function berlinDateKey(ms: number): string {
  return berlinDateFmt.format(new Date(ms));
}

/**
 * Milisegundos HÁBILES entre dos instantes: suma solo el solape de
 * [from, to] con la ventana 08:00–22:00 de cada día de Berlín.
 * Itera por días deduplicando por fecha Berlín (robusto ante DST).
 */
export function businessMsBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  let total = 0;
  const seen = new Set<string>();
  const startHH = String(HABIL_START).padStart(2, "0");
  const endHH   = String(HABIL_END).padStart(2, "0");
  // Empezamos un día antes y terminamos uno después para cubrir bordes de TZ.
  for (let t = fromMs - D, i = 0; t <= toMs + D && i < 400; t += D, i++) {
    const key = berlinDateKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const day = new Date(t);
    const ws = berlinClockToUtcMs(day, `${startHH}:00:00`);
    const we = berlinClockToUtcMs(day, `${endHH}:00:00`);
    const s = Math.max(fromMs, ws);
    const e = Math.min(toMs, we);
    if (e > s) total += e - s;
  }
  return total;
}

/** Formato compacto de antigüedad hábil: "45min", "3h", "2d". */
export function fmtHabil(ms: number): string {
  if (ms < H) return `${Math.max(1, Math.floor(ms / MIN))}min`;
  const habilDayMs = (HABIL_END - HABIL_START) * H;
  if (ms < 2 * habilDayMs) return `${Math.floor(ms / H)}h`;
  return `${Math.floor(ms / habilDayMs)}d`;
}

// ── Tipos ────────────────────────────────────────────────────────────

export type SemaforoColor = "rojo" | "amarillo" | "verde" | "fuera";
export type CausaTipo = "pago" | "respuesta" | "nuevo" | "postclase" | "vencida";
export type Regla =
  | "R1" | "R2" | "R3" | "R4" | "R5"
  | "A1" | "A2" | "A3"
  | "V1" | "V2" | "V3"
  | "FUERA" | "LIMBO";

/** Orden de cola dentro del rojo (spec): 💰 → 💬 → 🆕 → 🎓 → 📅 */
export const CAUSA_RANK: Record<CausaTipo, number> = {
  pago: 0, respuesta: 1, nuevo: 2, postclase: 3, vencida: 4,
};

export type Evidencia = {
  tipo: string;
  detalle: string;
  at: string | null;
};

export type SemaforoResult = {
  leadId: string;
  color: SemaforoColor;
  regla: Regla;
  causa: CausaTipo | null;
  /** Badge visible: "💬 Respuesta 3h" / "📅 Vencida 2d" / "💰 Convertido" */
  badge: string;
  detalle: string;
  /** Instante del disparador (orden por antigüedad). */
  triggerAt: string | null;
  /** true si el lead activo quedó sin V1/V3 — el anti-limbo debe sanarlo */
  limbo: boolean;
  evidencias: Evidencia[];
};

type ContactRow = {
  lead_id: string;
  direction: "saliente" | "entrante";
  action_type: string;
  occurred_at: string;
  actor_type: string;
  actor_name: string | null;
};

type TareaRow = {
  id: string;
  lead_id: string;
  tipo: string;
  plantilla: string;
  fecha_programada: string;
};

type ChainRow = { lead_id: string; chain_type: string; next_fire_at: string | null };
type VentaRow = { lead_id: string; created_at: string };

export type SemaforoLead = {
  id: string;
  created_at: string;
  status: string;
  estado_cierre: string | null;
  trial_scheduled_at: string | null;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
  sesion_plan_at: string | null;
};

export type SemaforoInput = {
  now: number;
  lead: SemaforoLead;
  /** Contactos del lead, cualquier orden. */
  contacts: ContactRow[];
  /** Tareas PENDIENTES (fecha_completada IS NULL). */
  tareas: TareaRow[];
  /** Cadena activa (completed_at IS NULL) o null. */
  chain: ChainRow | null;
  /** Venta pendiente más antigua o null. */
  ventaPendiente: VentaRow | null;
  /** Suelo temporal para R1/R3/R4/R5 — default SEMAFORO_EPOCH_MS.
   *  Los tests pasan 0 para evaluar sin suelo. */
  epochMs?: number;
};

// ── Evaluación PURA (testeable sin BD) ───────────────────────────────

export function evaluateSemaforo(input: SemaforoInput): SemaforoResult {
  const { now, lead, tareas, chain, ventaPendiente } = input;
  const epochMs = input.epochMs ?? SEMAFORO_EPOCH_MS;
  const ev: Evidencia[] = [];
  const R = (partial: Omit<SemaforoResult, "leadId" | "evidencias" | "limbo"> & { limbo?: boolean }): SemaforoResult =>
    ({ leadId: lead.id, evidencias: ev, limbo: partial.limbo ?? false, ...partial });

  // ── FUERA: archivado, sin color ──
  if (lead.estado_cierre === "perdido" || lead.status === "lost" || lead.status === "not_qualified") {
    ev.push({ tipo: "estado", detalle: `estado_cierre=${lead.estado_cierre} · status=${lead.status}`, at: null });
    return R({ color: "fuera", regla: "FUERA", causa: null, badge: "⚫ Fuera", detalle: "Perdido / no cualificado — archivado", triggerAt: null });
  }

  // Comparaciones de tiempo SIEMPRE numéricas — los ISO pueden venir en
  // formatos distintos (+02:00 vs Z) y el orden lexicográfico miente.
  const T = (iso: string) => new Date(iso).getTime();
  const contacts = [...input.contacts].sort((a, b) => T(a.occurred_at) - T(b.occurred_at));
  const salientes = contacts.filter(c => c.direction === "saliente");
  const lastSaliente = salientes[salientes.length - 1] ?? null;

  const inbounds = contacts.filter(c => c.direction === "entrante" && c.action_type === "mensaje_lead");
  const lastInbound = inbounds[inbounds.length - 1] ?? null;

  const convertido = lead.status === "converted" || lead.estado_cierre === "convertido";
  const pagado = convertido || contacts.some(c => c.action_type === "confirmar_pago");

  const hoyKey = berlinDateKey(now);

  // Instante del "enlace de pago enviado" más reciente: contacto
  // enviar_enlace o venta pendiente (lo que sea más reciente).
  const lastEnlaceContact = [...salientes].reverse().find(c => c.action_type === "enviar_enlace") ?? null;
  const enlaceAt = [
    lastEnlaceContact?.occurred_at ?? null,
    ventaPendiente?.created_at ?? null,
  ].filter((x): x is string => !!x).sort((a, b) => T(a) - T(b)).pop() ?? null;

  const tareasPend = [...tareas].sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));
  const tareaVencida = tareasPend.find(t => berlinDateKey(new Date(t.fecha_programada).getTime()) < hoyKey) ?? null;
  const tareaHoy = tareasPend.find(t => berlinDateKey(new Date(t.fecha_programada).getTime()) === hoyKey) ?? null;
  const tareaFutura = tareasPend.find(t => berlinDateKey(new Date(t.fecha_programada).getTime()) > hoyKey) ?? null;

  // ── ROJOS — se evalúan todos y gana el de mayor prioridad ──
  type Rojo = { causa: CausaTipo; regla: Regla; badge: string; detalle: string; triggerAt: string };
  const rojos: Rojo[] = [];

  // R3 💰 enlace de pago >3h hábiles sin pago ni saliente posterior
  if (enlaceAt && !pagado && T(enlaceAt) >= epochMs) {
    const enlaceMs = new Date(enlaceAt).getTime();
    const habil = businessMsBetween(enlaceMs, now);
    const salientePosterior = salientes.some(c => T(c.occurred_at) > enlaceMs);
    ev.push({ tipo: "enlace_pago", detalle: `enviado, ${fmtHabil(habil)} hábiles, saliente posterior: ${salientePosterior ? "sí" : "no"}`, at: enlaceAt });
    if (habil > UMBRAL_ENLACE_MS && !salientePosterior) {
      rojos.push({ causa: "pago", regla: "R3", badge: `💰 Link ${fmtHabil(habil)}`, detalle: `Enlace de pago sin pagar desde hace ${fmtHabil(habil)} hábiles`, triggerAt: enlaceAt });
    }
  }

  // R1 💬 inbound sin saliente posterior >2h hábiles
  if (lastInbound && T(lastInbound.occurred_at) >= epochMs) {
    const inMs = new Date(lastInbound.occurred_at).getTime();
    const atendido = salientes.some(c => T(c.occurred_at) > inMs);
    const habil = businessMsBetween(inMs, now);
    ev.push({ tipo: "inbound", detalle: `mensaje del lead, ${fmtHabil(habil)} hábiles, atendido: ${atendido ? "sí" : "no"}`, at: lastInbound.occurred_at });
    if (!atendido && habil > UMBRAL_RESPUESTA_MS) {
      rojos.push({ causa: "respuesta", regla: "R1", badge: `💬 Respuesta ${fmtHabil(habil)}`, detalle: `Respondió hace ${fmtHabil(habil)} hábiles — sin atender`, triggerAt: lastInbound.occurred_at });
    }
  }

  // R4 🆕 lead nuevo sin NINGÚN saliente (humano o Stiv) >30min hábiles.
  // No aplica a convertidos (leads backfilled/manuales sin contactos).
  if (salientes.length === 0 && !pagado && T(lead.created_at) >= epochMs) {
    const createdMs = new Date(lead.created_at).getTime();
    const habil = businessMsBetween(createdMs, now);
    ev.push({ tipo: "nuevo", detalle: `sin ningún contacto saliente, ${fmtHabil(habil)} hábiles desde el alta`, at: lead.created_at });
    if (habil > UMBRAL_NUEVO_MS) {
      rojos.push({ causa: "nuevo", regla: "R4", badge: `🆕 Nuevo ${fmtHabil(habil)}`, detalle: `Lead nuevo sin primer toque desde hace ${fmtHabil(habil)} hábiles`, triggerAt: lead.created_at });
    }
  }

  // R5 🎓 asistió (trial/sesión) >2h hábiles sin propuesta NI tarea futura
  if (lead.trial_attended_at && !pagado && T(lead.trial_attended_at) >= epochMs) {
    const attMs = new Date(lead.trial_attended_at).getTime();
    const habil = businessMsBetween(attMs, now);
    const propuestaDespues = salientes.some(c =>
      T(c.occurred_at) >= attMs &&
      (c.action_type === "enviar_propuesta" || c.action_type === "enviar_enlace" || c.action_type === "agendar_prueba"));
    // Una cadena activa YA es la jugada de cierre en marcha (su paso 1
    // manda el enlace de inscripción). Contarla evita que TODO lead que
    // asiste se ponga 🎓 rojo mientras Stiv trabaja — ruido que entrena
    // a ignorar el badge (Gelfis 2026-08-17). Coherente con V1.
    ev.push({ tipo: "post_evento", detalle: `asistió, ${fmtHabil(habil)} hábiles, propuesta después: ${propuestaDespues ? "sí" : "no"}, tarea futura: ${tareaFutura ? "sí" : "no"}, cadena activa: ${chain ? "sí" : "no"}`, at: lead.trial_attended_at });
    if (habil > UMBRAL_POSTCLASE_MS && !propuestaDespues && !tareaFutura && !chain) {
      rojos.push({ causa: "postclase", regla: "R5", badge: `🎓 Post-clase ${fmtHabil(habil)}`, detalle: `Asistió hace ${fmtHabil(habil)} hábiles sin propuesta ni tarea futura`, triggerAt: lead.trial_attended_at });
    }
  }

  // R2 📅 tarea vencida (due < hoy, día Berlín)
  if (tareaVencida) {
    const vencMs = new Date(tareaVencida.fecha_programada).getTime();
    const habil = businessMsBetween(vencMs, now);
    ev.push({ tipo: "tarea_vencida", detalle: `${tareaVencida.tipo} · ${tareaVencida.plantilla}`, at: tareaVencida.fecha_programada });
    rojos.push({ causa: "vencida", regla: "R2", badge: `📅 Vencida ${fmtHabil(habil)}`, detalle: `Tarea vencida: ${tareaVencida.plantilla}`, triggerAt: tareaVencida.fecha_programada });
  }

  if (rojos.length > 0) {
    rojos.sort((a, b) => {
      const r = CAUSA_RANK[a.causa] - CAUSA_RANK[b.causa];
      if (r !== 0) return r;
      return a.triggerAt.localeCompare(b.triggerAt); // más viejo primero
    });
    const top = rojos[0];
    return R({ color: "rojo", regla: top.regla, causa: top.causa, badge: top.badge, detalle: top.detalle, triggerAt: top.triggerAt });
  }

  // ── AMARILLOS ──
  // A2 trial/sesión agendada HOY (sin resultado aún)
  const eventoHoy =
    (lead.trial_scheduled_at && !lead.trial_attended_at && !lead.trial_absent_at &&
      berlinDateKey(new Date(lead.trial_scheduled_at).getTime()) === hoyKey && lead.trial_scheduled_at) ||
    (lead.sesion_plan_at && !lead.trial_attended_at && !lead.trial_absent_at &&
      berlinDateKey(new Date(lead.sesion_plan_at).getTime()) === hoyKey && lead.sesion_plan_at) || null;

  if (tareaHoy) {
    ev.push({ tipo: "tarea_hoy", detalle: `${tareaHoy.tipo} · ${tareaHoy.plantilla}`, at: tareaHoy.fecha_programada });
    return R({ color: "amarillo", regla: "A1", causa: null, badge: "🟡 Vence hoy", detalle: `Vence hoy: ${tareaHoy.plantilla}`, triggerAt: tareaHoy.fecha_programada });
  }
  if (eventoHoy) {
    ev.push({ tipo: "evento_hoy", detalle: "trial/sesión agendada para hoy", at: eventoHoy });
    return R({ color: "amarillo", regla: "A2", causa: null, badge: "🟡 Cita hoy", detalle: "Trial/Sesión agendada para HOY", triggerAt: eventoHoy });
  }
  if (enlaceAt && !pagado) {
    // (si llegó aquí, el enlace tiene <3h hábiles o hubo saliente posterior)
    const habil = businessMsBetween(new Date(enlaceAt).getTime(), now);
    if (habil <= UMBRAL_ENLACE_MS) {
      return R({ color: "amarillo", regla: "A3", causa: null, badge: `🟡 Link ${fmtHabil(habil)}`, detalle: `Enlace de pago enviado hace ${fmtHabil(habil)} hábiles — esperando pago`, triggerAt: enlaceAt });
    }
  }

  // ── VERDES ──
  if (convertido) {
    ev.push({ tipo: "convertido", detalle: `status=${lead.status} · estado_cierre=${lead.estado_cierre}`, at: null });
    return R({ color: "verde", regla: "V2", causa: null, badge: "💰 Convertido", detalle: "Pagó — verde hasta handoff a onboarding", triggerAt: null });
  }
  if (lead.estado_cierre === "en_reactivacion") {
    ev.push({ tipo: "reactivacion", detalle: "en backlog de reactivación", at: null });
    return R({ color: "verde", regla: "V3", causa: null, badge: "🟢 Reactivación", detalle: "En backlog de reactivación con fecha futura", triggerAt: null });
  }
  if (tareaFutura) {
    ev.push({ tipo: "tarea_futura", detalle: `${tareaFutura.tipo} · ${tareaFutura.plantilla}`, at: tareaFutura.fecha_programada });
    return R({ color: "verde", regla: "V1", causa: null, badge: "🟢 Al día", detalle: `Próxima jugada: ${tareaFutura.plantilla}`, triggerAt: tareaFutura.fecha_programada });
  }
  if (chain) {
    ev.push({ tipo: "cadena", detalle: `${chain.chain_type} · próximo envío ${chain.next_fire_at ?? "—"}`, at: chain.next_fire_at });
    return R({ color: "verde", regla: "V1", causa: null, badge: "🟢 Cadena activa", detalle: `Cadena ${chain.chain_type} corriendo`, triggerAt: chain.next_fire_at });
  }
  // Evento futuro agendado (trial/sesión mañana+) también es jugada.
  const eventoFuturo =
    (lead.trial_scheduled_at && !lead.trial_attended_at && !lead.trial_absent_at &&
      berlinDateKey(new Date(lead.trial_scheduled_at).getTime()) > hoyKey && lead.trial_scheduled_at) ||
    (lead.sesion_plan_at && !lead.trial_attended_at && !lead.trial_absent_at &&
      berlinDateKey(new Date(lead.sesion_plan_at).getTime()) > hoyKey && lead.sesion_plan_at) || null;
  if (eventoFuturo) {
    ev.push({ tipo: "evento_futuro", detalle: "trial/sesión agendada a futuro", at: eventoFuturo });
    return R({ color: "verde", regla: "V1", causa: null, badge: "🟢 Cita agendada", detalle: "Trial/Sesión agendada a futuro", triggerAt: eventoFuturo });
  }

  // ── LIMBO: lead activo sin jugada — el anti-limbo debe sanarlo ──
  ev.push({ tipo: "limbo", detalle: "sin tarea futura, sin cadena activa, sin cita — pendiente de auto-tarea", at: null });
  return R({ color: "verde", regla: "LIMBO", causa: null, badge: "⚠️ Sin jugada", detalle: "Lead activo sin próxima jugada — el sistema creará auto-tarea de seguimiento", triggerAt: null, limbo: true });
}

// ── Carga por lotes + evaluación ─────────────────────────────────────

export async function getSemaforoBatch(leadIds: string[]): Promise<Map<string, SemaforoResult>> {
  const out = new Map<string, SemaforoResult>();
  if (leadIds.length === 0) return out;
  const sb = supabaseAdmin();
  const now = Date.now();

  const [leadsRes, contactsRes, tareasRes, chainsRes, ventasRes] = await Promise.all([
    sb.from("leads")
      .select("id, created_at, status, estado_cierre, trial_scheduled_at, trial_attended_at, trial_absent_at, sesion_plan_at")
      .in("id", leadIds),
    sb.from("lead_contacts")
      .select("lead_id, direction, action_type, occurred_at, actor_type, actor_name")
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: false })
      .limit(4000),
    sb.from("tareas_closer")
      .select("id, lead_id, tipo, plantilla, fecha_programada")
      .in("lead_id", leadIds)
      .is("fecha_completada", null),
    sb.from("lead_chains")
      .select("lead_id, chain_type, next_fire_at")
      .in("lead_id", leadIds)
      .is("completed_at", null),
    sb.from("ventas")
      .select("lead_id, created_at")
      .in("lead_id", leadIds)
      .eq("estado", "pendiente"),
  ]);

  const contactsByLead = new Map<string, ContactRow[]>();
  for (const c of (contactsRes.data ?? []) as ContactRow[]) {
    const arr = contactsByLead.get(c.lead_id) ?? [];
    arr.push(c);
    contactsByLead.set(c.lead_id, arr);
  }
  const tareasByLead = new Map<string, TareaRow[]>();
  for (const t of (tareasRes.data ?? []) as TareaRow[]) {
    const arr = tareasByLead.get(t.lead_id) ?? [];
    arr.push(t);
    tareasByLead.set(t.lead_id, arr);
  }
  const chainByLead = new Map<string, ChainRow>();
  for (const c of (chainsRes.data ?? []) as ChainRow[]) {
    if (!chainByLead.has(c.lead_id)) chainByLead.set(c.lead_id, c);
  }
  const ventaByLead = new Map<string, VentaRow>();
  for (const v of (ventasRes.data ?? []) as VentaRow[]) {
    const prev = ventaByLead.get(v.lead_id);
    if (!prev || v.created_at < prev.created_at) ventaByLead.set(v.lead_id, v);
  }

  for (const lead of (leadsRes.data ?? []) as SemaforoLead[]) {
    out.set(lead.id, evaluateSemaforo({
      now,
      lead,
      contacts: contactsByLead.get(lead.id) ?? [],
      tareas: tareasByLead.get(lead.id) ?? [],
      chain: chainByLead.get(lead.id) ?? null,
      ventaPendiente: ventaByLead.get(lead.id) ?? null,
    }));
  }
  return out;
}

export async function getSemaforo(leadId: string): Promise<SemaforoResult | null> {
  return (await getSemaforoBatch([leadId])).get(leadId) ?? null;
}

// ── Rojo propio del PROFESOR (spec sección 4, variante 🎓 de R5) ─────

/**
 * El único generador de rojo propio del profe: la clase de prueba ya
 * pasó hace >2h hábiles y no registró asistencia (✓/✗). Devuelve el
 * badge o null si está al día.
 */
export function feedbackPendienteProfe(args: {
  scheduledAt: string | null;
  durationMin?: number | null;
  attendedAt: string | null;
  absentAt: string | null;
  now?: number;
  epochMs?: number;
}): { badge: string; detalle: string } | null {
  if (!args.scheduledAt || args.attendedAt || args.absentAt) return null;
  const now = args.now ?? Date.now();
  const endMs = new Date(args.scheduledAt).getTime() + (args.durationMin ?? 40) * MIN;
  if (endMs > now) return null;
  // Epoch C6: clases anteriores al arranque no generan rojo retroactivo.
  if (endMs < (args.epochMs ?? SEMAFORO_EPOCH_MS)) return null;
  const habil = businessMsBetween(endMs, now);
  if (habil <= UMBRAL_POSTCLASE_MS) return null;
  return {
    badge: `🎓 Post-clase ${fmtHabil(habil)}`,
    detalle: `La clase terminó hace ${fmtHabil(habil)} hábiles — registra ✓ Asistió / ✗ No asistió`,
  };
}

// ── Anti-limbo: constraint del flujo de guardado (spec sección 3) ────

/**
 * Tras guardar cualquier acción: si el lead activo queda sin tarea
 * futura NI cadena activa NI cita agendada → crea auto-tarea
 * "Seguimiento" a +3 días (10:00 Berlín). No es una sugerencia: es
 * la regla que garantiza que ningún lead activo quede sin jugada.
 * No aplica a convertidos/perdidos ni a leads sin closer asignado.
 */
export async function ensureFuturePlay(leadId: string): Promise<{ created: boolean }> {
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, closer_id, status, estado_cierre, created_at, trial_scheduled_at, trial_attended_at, trial_absent_at, sesion_plan_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { created: false };
  const l = lead as SemaforoLead & { closer_id: string | null };
  if (!l.closer_id) return { created: false };
  if (l.status === "converted" || l.status === "lost" ||
      l.estado_cierre === "convertido" || l.estado_cierre === "perdido" ||
      l.estado_cierre === "en_reactivacion") {
    return { created: false };
  }

  const nowIso = new Date().toISOString();
  const [tareasRes, chainRes] = await Promise.all([
    sb.from("tareas_closer")
      .select("id")
      .eq("lead_id", leadId)
      .is("fecha_completada", null)
      .gt("fecha_programada", nowIso)
      .limit(1),
    sb.from("lead_chains")
      .select("id")
      .eq("lead_id", leadId)
      .is("completed_at", null)
      .limit(1),
  ]);
  if ((tareasRes.data ?? []).length > 0) return { created: false };
  if ((chainRes.data ?? []).length > 0) return { created: false };

  // Cita futura también cuenta como jugada.
  const hoyKey = berlinDateKey(Date.now());
  const citaFutura =
    (l.trial_scheduled_at && !l.trial_attended_at && !l.trial_absent_at &&
      berlinDateKey(new Date(l.trial_scheduled_at).getTime()) >= hoyKey) ||
    (l.sesion_plan_at && !l.trial_attended_at && !l.trial_absent_at &&
      berlinDateKey(new Date(l.sesion_plan_at).getTime()) >= hoyKey);
  if (citaFutura) return { created: false };

  // +3 días a las 10:00 Berlín.
  const target = new Date(Date.now() + AUTO_SEGUIMIENTO_DIAS * D);
  const fechaMs = berlinClockToUtcMs(target, "10:00:00");

  await sb.from("tareas_closer").insert({
    closer_id: l.closer_id,
    lead_id: leadId,
    paso: 99,
    tipo: "auto_seguimiento",
    canal: "whatsapp",
    plantilla: "Seguimiento (auto) — el lead quedó sin próxima jugada",
    fecha_programada: new Date(fechaMs).toISOString(),
  });
  return { created: true };
}
