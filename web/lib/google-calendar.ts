// Build cache bust: 2026-05-02 — Vercel deploy 1ff7bd1 falló sin
// cambios de código identificables; build local pasa limpio. Este
// no-op fuerza un nuevo intento con cache invalidado.
/**
 * Google Calendar — espejo de las clases de prueba en el calendar
 * personal de Gelfis (`aprenderaleman2026@gmail.com`).
 *
 * Modelo de auth: Service Account.
 *   1. La SA crea/borra eventos llamando la Calendar API.
 *   2. Tú compartiste tu calendar con el email de la SA dándole
 *      permiso "Make changes to events" — por eso los eventos
 *      aparecen en TU calendar pero el "Created by" técnicamente
 *      es la SA.
 *   3. No invitamos al lead como `attendee` desde aquí (Gmail
 *      personal sin domain-wide delegation no puede enviar invites
 *      en tu nombre). Para que el lead se añada el evento a SU
 *      calendar le adjuntamos un .ics al email — ver `lib/ics.ts`.
 *
 * env-gate: si `GOOGLE_CALENDAR_ID` o `GOOGLE_SERVICE_ACCOUNT_JSON`
 * faltan, todas las funciones devuelven `null` sin tirar excepción.
 * Esto deja dev/preview funcionando sin la integración mientras
 * producción la usa cuando estén las envs.
 */

import type { calendar_v3 } from "@googleapis/calendar";

type CreateArgs = {
  /** Lead's first name + teacher's first name. Va al título. */
  leadName:    string;
  teacherName: string;
  /** ISO start. Duración en minutos para calcular end. */
  startIso:        string;
  durationMinutes: number;
  /** Para el cuerpo de la descripción del evento. */
  leadEmail:       string | null;
  leadWhatsapp:    string | null;
  germanLevel:     string | null;
  goal:            string | null;
  joinUrl:         string;        // https://b2c.aprender-aleman.de/c/{shortCode}
};

export type CreatedEvent = {
  eventId:  string;
  htmlLink: string | null;
};

/**
 * Carga lazy del cliente. La librería googleapis es ~3 MB resuelta;
 * solo la cargamos cuando alguien va a llamar a la API. Los renders
 * que no tocan calendar (la mayoría) no la incluyen en su closure.
 */
async function getCalendarClient(): Promise<calendar_v3.Calendar | null> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calId = process.env.GOOGLE_CALENDAR_ID;
  if (!json || !calId) return null;

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("[gcal] GOOGLE_SERVICE_ACCOUNT_JSON not valid JSON");
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) {
    console.error("[gcal] SA JSON missing client_email or private_key");
    return null;
  }

  // Swapped from full `googleapis` package (~50MB resolved, kept failing
  // npm install on Vercel) to the per-API split `@googleapis/calendar`
  // plus `google-auth-library` for the JWT. Same scopes, same v3 API.
  const { JWT } = await import("google-auth-library");
  const { calendar } = await import("@googleapis/calendar");
  // Newlines in the env var arrive as literal "\n" in some hosts; normalise.
  const privateKey = parsed.private_key.replace(/\\n/g, "\n");
  const auth = new JWT({
    email: parsed.client_email,
    key:   privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });

  return calendar({ version: "v3", auth });
}


/**
 * Crea el evento de la clase de prueba en el calendar de Gelfis.
 * Devuelve `eventId` (para guardar en classes.google_calendar_event_id)
 * o `null` si la integración no está configurada o el create falló —
 * en ambos casos el booking del lead sigue funcionando, solo nos
 * quedamos sin el espejo en GCal.
 */
export async function createTrialEvent(a: CreateArgs): Promise<CreatedEvent | null> {
  const cal = await getCalendarClient();
  if (!cal) return null;

  const calendarId = process.env.GOOGLE_CALENDAR_ID!;
  const start = new Date(a.startIso);
  const end   = new Date(start.getTime() + a.durationMinutes * 60_000);

  const leadFirst = (a.leadName || "").split(/\s+/)[0] || a.leadName || "Lead";

  // Copy comercial decidida por Gelfis 2026-05-02. La descripción
  // empieza con el pitch (es lo primero que ve el lead si abre el
  // evento desde su .ics) y termina con el bloque interno de datos
  // del lead, que solo aparece en TU calendar — necesario para
  // preparar la clase. El profesor no se nombra en la copy pública.
  const lines: string[] = [
    "¿Quieres probar nuestro método antes de comprometerte?",
    "",
    "Reserva una sesión individual de 45 minutos con un profesor bilingüe experto. Analizaremos tu nivel, definiremos tus objetivos y vivirás la experiencia de nuestra metodología.",
    "",
    `Aula: ${a.joinUrl}`,
    "",
    "—",
    `Lead: ${a.leadName}`,
    a.leadEmail    ? `Email: ${a.leadEmail}` : null,
    a.leadWhatsapp ? `WhatsApp: ${a.leadWhatsapp}` : null,
    a.germanLevel  ? `Nivel: ${a.germanLevel}` : null,
    a.goal         ? `Objetivo: ${a.goal}` : null,
  ].filter(Boolean) as string[];

  try {
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary:     `${leadFirst} + Sesión de Prueba de Alemán ☀️`,
        description: lines.join("\n"),
        start: { dateTime: start.toISOString(), timeZone: "Europe/Berlin" },
        end:   { dateTime: end.toISOString(),   timeZone: "Europe/Berlin" },
        // Per Gelfis: SIN recordatorios. Solo el evento en el calendar.
        reminders: { useDefault: false, overrides: [] },
        // location vacío — el aula virtual va en la descripción para que
        // sea fácil clickear sin recortar.
      },
    });
    const data = res.data;
    if (!data.id) {
      console.warn("[gcal] insert returned no event id");
      return null;
    }
    return { eventId: data.id, htmlLink: data.htmlLink ?? null };
  } catch (e) {
    console.error("[gcal] insert failed:", e instanceof Error ? e.message : e);
    return null;
  }
}


/**
 * Mueve un evento existente a un nuevo horario. Usado por el flujo de
 * "cambio de hora" del trial (agents/reschedule_flow.py). Idempotente:
 * si el evento no existe (404) lo logueamos y devolvemos false para que
 * el caller decida (típicamente: registrar en lead_timeline y seguir,
 * la fila en `classes` es la fuente de verdad real).
 */
export async function patchTrialEvent(
  eventId:        string,
  newStartIso:    string,
  durationMinutes: number,
): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const calendarId = process.env.GOOGLE_CALENDAR_ID!;
  const start = new Date(newStartIso);
  const end   = new Date(start.getTime() + durationMinutes * 60_000);

  try {
    await cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: start.toISOString(), timeZone: "Europe/Berlin" },
        end:   { dateTime: end.toISOString(),   timeZone: "Europe/Berlin" },
      },
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404") || msg.includes("Resource has been deleted")) {
      console.warn(`[gcal] patch: event ${eventId} not found (already deleted?)`);
      return false;
    }
    console.error("[gcal] patch failed:", msg);
    return false;
  }
}

/**
 * Elimina el evento espejo. Llamado desde el flujo de cancelación de
 * clases. Idempotente: si el id no existe (ya borrado) o la SA perdió
 * permiso, lo logueamos y seguimos. La cancelación de la clase NO se
 * bloquea por un fallo aquí.
 */
export async function deleteTrialEvent(eventId: string): Promise<boolean> {
  const cal = await getCalendarClient();
  if (!cal) return false;

  const calendarId = process.env.GOOGLE_CALENDAR_ID!;
  try {
    await cal.events.delete({ calendarId, eventId });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404") || msg.includes("Resource has been deleted")) {
      // Already gone — count as success.
      return true;
    }
    console.error("[gcal] delete failed:", msg);
    return false;
  }
}


/**
 * Lo expongo separado para usarlo en /admin/system o un health check
 * ("¿está operativa la integración con GCal?"). Sin tirar excepción.
 */
export function googleCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID);
}


// ─────────────────────────────────────────────────────────────
// freeBusy — consultar intervalos ocupados del calendar de Gelfis
// para que el slot picker del funnel no ofrezca horas que choquen
// con eventos personales (médico, reunión, lo que sea).
//
// Cache de 5 min en memoria del módulo. El slot picker se llama por
// cada visitante del funnel; sin cache sería un DDoS contra la API
// de Google. La key del cache incluye los timestamps redondeados a
// la hora porque pequeños cambios de "now" no cambian materialmente
// el conjunto de busy intervals.
// ─────────────────────────────────────────────────────────────

export type BusyInterval = { startMs: number; endMs: number };

type CacheEntry = { intervals: BusyInterval[]; expiresAtMs: number };
const busyCache = new Map<string, CacheEntry>();
const BUSY_CACHE_TTL_MS = 5 * 60_000;

function cacheKey(timeMinIso: string, timeMaxIso: string): string {
  // Round both timestamps to the hour so we get cache hits across
  // close-enough calls.
  const min = new Date(timeMinIso); min.setUTCMinutes(0, 0, 0);
  const max = new Date(timeMaxIso); max.setUTCMinutes(0, 0, 0);
  return `${min.toISOString()}|${max.toISOString()}`;
}

/**
 * Devuelve los intervalos ocupados del calendar `GOOGLE_CALENDAR_ID`
 * entre `timeMinIso` y `timeMaxIso`. Si la integración no está
 * configurada o la API de Google falla, devuelve [] — fail-open
 * para no bloquear el funnel.
 */
export async function getCalendarBusy(
  timeMinIso: string,
  timeMaxIso: string,
): Promise<BusyInterval[]> {
  const cal = await getCalendarClient();
  if (!cal) return [];
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) return [];

  const key = cacheKey(timeMinIso, timeMaxIso);
  const now = Date.now();
  const cached = busyCache.get(key);
  if (cached && cached.expiresAtMs > now) {
    return cached.intervals;
  }

  try {
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        items:   [{ id: calendarId }],
      },
    });
    const cals = res.data.calendars ?? {};
    const entry = cals[calendarId];
    const busy = entry?.busy ?? [];
    const intervals: BusyInterval[] = busy
      .filter(b => b.start && b.end)
      .map(b => ({
        startMs: new Date(b.start as string).getTime(),
        endMs:   new Date(b.end   as string).getTime(),
      }));

    busyCache.set(key, { intervals, expiresAtMs: now + BUSY_CACHE_TTL_MS });
    // Trim cache si crece — evita memory leak en runtime de larga vida.
    if (busyCache.size > 50) {
      const oldest = [...busyCache.entries()]
        .sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs)[0];
      if (oldest) busyCache.delete(oldest[0]);
    }
    return intervals;
  } catch (e) {
    console.error("[gcal] freeBusy query failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
