import { supabaseAdmin } from "./supabase";
import { getLastContacts, type LastContact } from "./contacts";

/**
 * CRM Closer F2 (Gelfis 2026-11-25) — cola derivada de /closer/urgentes.
 * Sin estado propio: todo se calcula al leer desde leads + lead_contacts
 * + tareas_closer.
 *
 * Cuatro tramos (Gelfis 2026-11-27):
 *   bono       — asistió hace <48h: el Bono de Acción Rápida sigue VIVO.
 *     Las primeras 24h está "en espera" (la llamada la marca la tarea de
 *     las 24h, F5); después se ordena por bono restante.
 *   post_trial — asistió hace 2–7 días sin cierre (bono vencido, ventana
 *     aún caliente).
 *   no_show    — no asistió al trial.
 *   antiguo    — asistió hace más de 7 días sin convertir (backlog que se
 *     trabaja poco a poco) o asignado a mano. Sin sesión-plan: esos viven
 *     en "Mis leads".
 *
 * Seguimiento pactado (Gelfis 2026-11-27): un lead con tarea
 * seguimiento_fecha pendiente y FUTURA se oculta de la cola y reaparece
 * en su tramo cuando llega la fecha, con chip "📆 Seguimiento".
 */

export const BONO_MS   = 48 * 3_600_000;
export const ESPERA_MS = 24 * 3_600_000;
/** Asistidos más viejos que esto pasan de Post-trial a Antiguos. */
export const POST_TRIAL_VENTANA_MS = 7 * 24 * 3_600_000;

export type CloserUrgenteTramo = "bono" | "post_trial" | "no_show" | "antiguo";

export type CloserUrgenteItem = {
  leadId: string;
  nombre: string;
  whatsapp: string | null;
  tramo: CloserUrgenteTramo;
  trialAttendedAt: string | null;
  trialAbsentAt: string | null;
  fechaAsignacion: string | null;
  /** ms que quedan de bono (asistencia + 48h); null si venció o no aplica */
  bonoRestanteMs: number | null;
  /** true → aún no pasaron 24h del trial: no llamar todavía */
  enEspera: boolean;
  /** Fecha del seguimiento pactado ya vencido (el lead reaparece con chip) */
  seguimientoAt: string | null;
  ultimoContacto: LastContact | null;
};

export type CloserUrgentes = {
  bono: CloserUrgenteItem[];
  postTrial: CloserUrgenteItem[];
  noShows: CloserUrgenteItem[];
  antiguos: CloserUrgenteItem[];
  /** Leads ocultos por seguimiento pactado con fecha futura */
  ocultosSeguimiento: number;
};

type LeadRow = {
  id: string;
  name: string | null;
  whatsapp_normalized: string | null;
  estado_cierre: string | null;
  status: string;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
  fecha_asignacion_closer: string | null;
  sesion_plan_at: string | null;
};

export async function getCloserUrgentes(closerId: string): Promise<CloserUrgentes> {
  const sb = supabaseAdmin();
  const now = Date.now();

  const { data } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, estado_cierre, status, trial_attended_at, trial_absent_at, fecha_asignacion_closer, sesion_plan_at")
    .eq("closer_id", closerId)
    .in("estado_cierre", ["activo", "seguimiento_pactado"])
    .not("status", "in", "(converted,lost)")
    .limit(500);

  const rows = (data ?? []) as LeadRow[];

  // Seguimientos pactados pendientes: futuro → ocultar; vencido → chip.
  const segFuturo = new Set<string>();
  const segVencido = new Map<string, string>();
  if (rows.length > 0) {
    const { data: tareas } = await sb
      .from("tareas_closer")
      .select("lead_id, fecha_programada")
      .eq("tipo", "seguimiento_fecha")
      .is("fecha_completada", null)
      .in("lead_id", rows.map((r) => r.id));
    for (const t of (tareas ?? []) as Array<{ lead_id: string; fecha_programada: string }>) {
      if (new Date(t.fecha_programada).getTime() > now) {
        segFuturo.add(t.lead_id);
      } else {
        const prev = segVencido.get(t.lead_id);
        if (!prev || t.fecha_programada < prev) segVencido.set(t.lead_id, t.fecha_programada);
      }
    }
  }

  const lastContacts = await getLastContacts(rows.map((r) => r.id));

  const toItem = (r: LeadRow, tramo: CloserUrgenteTramo): CloserUrgenteItem => {
    const attendedMs = r.trial_attended_at ? new Date(r.trial_attended_at).getTime() : null;
    const bonoFin = attendedMs !== null ? attendedMs + BONO_MS : null;
    return {
      leadId: r.id,
      nombre: r.name ?? "(sin nombre)",
      whatsapp: r.whatsapp_normalized,
      tramo,
      trialAttendedAt: r.trial_attended_at,
      trialAbsentAt: r.trial_absent_at,
      fechaAsignacion: r.fecha_asignacion_closer,
      bonoRestanteMs: tramo === "bono" && bonoFin !== null && bonoFin > now ? bonoFin - now : null,
      enEspera: tramo === "bono" && attendedMs !== null && now - attendedMs < ESPERA_MS,
      seguimientoAt: segVencido.get(r.id) ?? null,
      ultimoContacto: lastContacts.get(r.id) ?? null,
    };
  };

  const bono: CloserUrgenteItem[] = [];
  const postTrial: CloserUrgenteItem[] = [];
  const noShows: CloserUrgenteItem[] = [];
  const antiguos: CloserUrgenteItem[] = [];
  let ocultosSeguimiento = 0;

  for (const r of rows) {
    // Los leads del funnel /sesion-plan viven en "Mis leads" (semáforo +
    // cadencias). OJO: la sesión de plan también escribe trial_attended_at
    // (sesion-resultado), así que sin este filtro saldrían duplicados.
    if (r.sesion_plan_at) continue;

    // Seguimiento pactado a futuro: fuera de la cola hasta su fecha.
    if (segFuturo.has(r.id)) { ocultosSeguimiento++; continue; }

    const attendedAge = r.trial_attended_at ? now - new Date(r.trial_attended_at).getTime() : null;
    if (attendedAge !== null && attendedAge < BONO_MS) {
      bono.push(toItem(r, "bono"));
    } else if (attendedAge !== null && attendedAge < POST_TRIAL_VENTANA_MS) {
      postTrial.push(toItem(r, "post_trial"));
    } else if (attendedAge !== null) {
      // Asistió hace más de 7 días sin convertir → backlog "Antiguos".
      antiguos.push(toItem(r, "antiguo"));
    } else if (r.trial_absent_at) {
      noShows.push(toItem(r, "no_show"));
    } else {
      antiguos.push(toItem(r, "antiguo"));
    }
  }

  // Bono: activos por bono restante (menos tiempo arriba); los "en
  // espera" al final, por hora de asistencia.
  bono.sort((a, b) => {
    if (a.enEspera !== b.enEspera) return a.enEspera ? 1 : -1;
    if (!a.enEspera) {
      const ba = a.bonoRestanteMs ?? Number.MAX_SAFE_INTEGER;
      const bb = b.bonoRestanteMs ?? Number.MAX_SAFE_INTEGER;
      if (ba !== bb) return ba - bb;
    }
    return new Date(a.trialAttendedAt ?? 0).getTime() - new Date(b.trialAttendedAt ?? 0).getTime();
  });

  // Post-trial: el más viejo dentro de la ventana primero (se enfría).
  postTrial.sort((a, b) =>
    new Date(a.trialAttendedAt ?? 0).getTime() - new Date(b.trialAttendedAt ?? 0).getTime());

  // No-shows: el más reciente primero (rescate caliente).
  noShows.sort((a, b) =>
    new Date(b.trialAbsentAt ?? 0).getTime() - new Date(a.trialAbsentAt ?? 0).getTime());

  // Antiguos: sin contacto primero, luego último contacto más viejo.
  antiguos.sort((a, b) => {
    const ca = a.ultimoContacto ? new Date(a.ultimoContacto.occurred_at).getTime() : 0;
    const cb = b.ultimoContacto ? new Date(b.ultimoContacto.occurred_at).getTime() : 0;
    return ca - cb;
  });

  return { bono, postTrial, noShows, antiguos, ocultosSeguimiento };
}
