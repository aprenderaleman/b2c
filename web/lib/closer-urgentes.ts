import { supabaseAdmin } from "./supabase";
import { getLastContacts, type LastContact } from "./contacts";

/**
 * CRM Closer F2 (Gelfis 2026-11-25) — cola derivada de /closer/urgentes.
 * Sin estado propio: todo se calcula al leer desde leads + lead_contacts.
 *
 * Tres tramos:
 *   post_trial — asistió al trial y sigue sin cierre. Las primeras 24h
 *     está "en espera" (la llamada la marca la tarea de las 24h, F5);
 *     después se ordena por bono restante (asistencia + 48h).
 *   no_show   — no asistió al trial.
 *   antiguo   — asignado a mano, sin trial reciente y sin sesión-plan
 *     (los de /sesion-plan viven en "Mis leads").
 */

export const BONO_MS   = 48 * 3_600_000;
export const ESPERA_MS = 24 * 3_600_000;

export type CloserUrgenteTramo = "post_trial" | "no_show" | "antiguo";

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
  ultimoContacto: LastContact | null;
};

export type CloserUrgentes = {
  postTrial: CloserUrgenteItem[];
  noShows: CloserUrgenteItem[];
  antiguos: CloserUrgenteItem[];
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
      bonoRestanteMs: tramo === "post_trial" && bonoFin !== null && bonoFin > now ? bonoFin - now : null,
      enEspera: tramo === "post_trial" && attendedMs !== null && now - attendedMs < ESPERA_MS,
      ultimoContacto: lastContacts.get(r.id) ?? null,
    };
  };

  const postTrial: CloserUrgenteItem[] = [];
  const noShows: CloserUrgenteItem[] = [];
  const antiguos: CloserUrgenteItem[] = [];

  for (const r of rows) {
    // Los leads del funnel /sesion-plan viven en "Mis leads" (semáforo +
    // cadencias). OJO: la sesión de plan también escribe trial_attended_at
    // (sesion-resultado), así que sin este filtro saldrían duplicados.
    if (r.sesion_plan_at) continue;

    if (r.trial_attended_at) {
      postTrial.push(toItem(r, "post_trial"));
    } else if (r.trial_absent_at) {
      noShows.push(toItem(r, "no_show"));
    } else {
      antiguos.push(toItem(r, "antiguo"));
    }
  }

  // Post-trial: primero los activos por bono restante (menos tiempo =
  // más arriba; vencidos al final de los activos), luego los en espera
  // por hora de asistencia.
  postTrial.sort((a, b) => {
    if (a.enEspera !== b.enEspera) return a.enEspera ? 1 : -1;
    if (!a.enEspera) {
      const ba = a.bonoRestanteMs ?? Number.MAX_SAFE_INTEGER;
      const bb = b.bonoRestanteMs ?? Number.MAX_SAFE_INTEGER;
      if (ba !== bb) return ba - bb;
    }
    return new Date(a.trialAttendedAt ?? 0).getTime() - new Date(b.trialAttendedAt ?? 0).getTime();
  });

  // No-shows: el más reciente primero (rescate caliente).
  noShows.sort((a, b) =>
    new Date(b.trialAbsentAt ?? 0).getTime() - new Date(a.trialAbsentAt ?? 0).getTime());

  // Antiguos: sin contacto primero, luego último contacto más viejo.
  antiguos.sort((a, b) => {
    const ca = a.ultimoContacto ? new Date(a.ultimoContacto.occurred_at).getTime() : 0;
    const cb = b.ultimoContacto ? new Date(b.ultimoContacto.occurred_at).getTime() : 0;
    return ca - cb;
  });

  return { postTrial, noShows, antiguos };
}
