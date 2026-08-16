/**
 * Dispatcher del calendar de un closer.
 *
 * Un closer puede usar dos backends distintos:
 *   · 'oauth'  — vinculó su Google Calendar personal (tabla
 *                closer_google_credentials). Se usa OAuth per-closer.
 *   · 'shared' — es admin/superadmin y el sistema tiene configurado
 *                un shared Service Account calendar (env GOOGLE_CALENDAR_ID
 *                + GOOGLE_SERVICE_ACCOUNT_JSON). Usado por Gelfis
 *                (el CEO también hace de closer): reutiliza el
 *                mismo calendar donde ya se agendan trials.
 *   · 'none'   — no hay integración; ops no-op y freeBusy [].
 *
 * Esta capa esconde esa decisión para que los call-sites (book-sesion-plan,
 * sesion-slots, backfill) trabajen contra una API homogénea.
 */
import { supabaseAdmin } from "./supabase";
import {
  createCloserSesionEvent,
  patchCloserSesionEvent,
  deleteCloserSesionEvent,
  getCloserCalendarBusy,
} from "./closer-google-calendar";
import {
  createInfoCallEvent,
  patchTrialEvent,
  deleteTrialEvent,
  getCalendarBusy,
  googleCalendarConfigured,
  type BusyInterval,
} from "./google-calendar";

type CalendarKind = "oauth" | "shared" | "none";

export type SesionEventArgs = {
  leadName:        string;
  startIso:        string;
  durationMinutes: number;
  leadEmail:       string | null;
  leadWhatsapp:    string | null;
  germanLevel:     string | null;
  goal:            string | null;
  deadline:        string | null;
  joinUrl:         string;
  confirmacionUrl: string | null;
};

async function resolveCloserCalendarKind(closerId: string): Promise<CalendarKind> {
  const sb = supabaseAdmin();

  // 1. OAuth per-closer tiene prioridad — si el closer vinculó su calendar,
  //    respeta esa elección (incluso siendo admin) para evitar sorpresas.
  const { data: creds } = await sb
    .from("closer_google_credentials")
    .select("closer_id")
    .eq("closer_id", closerId)
    .maybeSingle();
  if (creds) return "oauth";

  // 2. Shared SA calendar. Aplica en dos casos:
  //    (a) role admin/superadmin (uso del CEO desde consola admin).
  //    (b) el user es el propio Gelfis actuando como closer: mismo
  //        email que ADMIN_EMAIL o que GOOGLE_CALENDAR_ID. Esto cubre
  //        el perfil "Gelfis Closer" (info@aprender-aleman.de, role
  //        closer) para que sus sesiones se agenden en el mismo
  //        calendar personal donde viven los trials, sin OAuth aparte.
  const { data: user } = await sb
    .from("users")
    .select("role, email")
    .eq("id", closerId)
    .maybeSingle();
  const row  = user as { role: string | null; email: string | null } | null;
  const role = row?.role  ?? null;
  const mail = (row?.email ?? "").toLowerCase();
  const sharedEmails = new Set<string>([
    (process.env.ADMIN_EMAIL         ?? "").toLowerCase(),
    (process.env.GOOGLE_CALENDAR_ID  ?? "").toLowerCase(),
  ].filter(Boolean));
  const isSharedUser = role === "admin" || role === "superadmin" || sharedEmails.has(mail);
  if (isSharedUser && googleCalendarConfigured()) {
    return "shared";
  }

  return "none";
}

/**
 * Crea el evento en el calendar apropiado. Devuelve el eventId a guardar
 * en `classes.closer_gcal_event_id`, o null si no hay integración.
 */
export async function createSesionEventForCloser(
  closerId: string,
  args: SesionEventArgs,
): Promise<string | null> {
  const kind = await resolveCloserCalendarKind(closerId);
  if (kind === "oauth") {
    const ev = await createCloserSesionEvent(closerId, args);
    return ev?.eventId ?? null;
  }
  if (kind === "shared") {
    // Reusa createInfoCallEvent — ya escribe al shared calendar de
    // Gelfis y su copy encaja (llamada corta con un lead). Añadimos
    // motivo/objetivo del wizard como motivoInicial para que sea claro.
    const ev = await createInfoCallEvent({
      leadName:        args.leadName,
      startIso:        args.startIso,
      durationMinutes: args.durationMinutes,
      leadEmail:       args.leadEmail,
      leadWhatsapp:    args.leadWhatsapp,
      germanLevel:     args.germanLevel,
      goal:            args.goal,
      motivoInicial:   `Sesión de Plan — ${args.goal ?? "?"} · plazo ${args.deadline ?? "?"}`,
    });
    return ev?.eventId ?? null;
  }
  return null;
}

/**
 * Mueve el evento a un nuevo horario. Devuelve true si el patch tuvo
 * éxito, false si el evento no existe (el caller decidirá si recrear).
 */
export async function patchSesionEventForCloser(
  closerId:        string,
  eventId:         string,
  newStartIso:     string,
  durationMinutes: number,
): Promise<boolean> {
  const kind = await resolveCloserCalendarKind(closerId);
  if (kind === "oauth") {
    return patchCloserSesionEvent(closerId, eventId, newStartIso, durationMinutes);
  }
  if (kind === "shared") {
    return patchTrialEvent(eventId, newStartIso, durationMinutes);
  }
  return false;
}

export async function deleteSesionEventForCloser(
  closerId: string,
  eventId:  string,
): Promise<boolean> {
  const kind = await resolveCloserCalendarKind(closerId);
  if (kind === "oauth") {
    return deleteCloserSesionEvent(closerId, eventId);
  }
  if (kind === "shared") {
    return deleteTrialEvent(eventId);
  }
  return false;
}

/**
 * FreeBusy del calendar del closer entre dos ISOs. Devuelve [] si no
 * hay integración configurada (fail-open — no bloquear el slot picker).
 */
export async function getBusyForCloser(
  closerId:   string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<BusyInterval[]> {
  const kind = await resolveCloserCalendarKind(closerId);
  if (kind === "oauth") {
    return getCloserCalendarBusy(closerId, timeMinIso, timeMaxIso);
  }
  if (kind === "shared") {
    return getCalendarBusy(timeMinIso, timeMaxIso);
  }
  return [];
}

/**
 * Batch: freeBusy por closer. Corre las llamadas en paralelo para no
 * secuenciar RTTs. Devuelve un map closerId → intervalos.
 */
export async function getBusyForClosers(
  closerIds:  string[],
  timeMinIso: string,
  timeMaxIso: string,
): Promise<Map<string, BusyInterval[]>> {
  const out = new Map<string, BusyInterval[]>();
  await Promise.all(
    closerIds.map(async (id) => {
      out.set(id, await getBusyForCloser(id, timeMinIso, timeMaxIso));
    }),
  );
  return out;
}
