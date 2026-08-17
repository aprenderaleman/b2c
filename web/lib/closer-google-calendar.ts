/**
 * Google Calendar OAuth — per-closer personal calendar integration.
 *
 * Gemelo de `google-calendar-oauth.ts` (que es para teachers) pero para
 * closers, cuya identidad vive directamente en `users` (no en `teachers`).
 *
 * Uso principal: agendar la Sesión de Plan-Alemán (funnel /sesion-plan) en el
 * calendar personal del closer que la recibe. Cuando el lead reagenda,
 * hacemos patch del evento; cuando cambia el closer asignado, borramos
 * el del anterior y creamos uno nuevo en el del nuevo.
 *
 * env-gate: si faltan `GOOGLE_OAUTH_CLIENT_ID`, `_SECRET` o
 * `GOOGLE_OAUTH_CLOSER_REDIRECT_URI`, todo devuelve null/[] sin tirar.
 * Esto deja dev/preview funcionando sin la integración configurada.
 *
 * Reutilizamos las mismas credenciales de OAuth Client que teachers,
 * solo cambia el redirect URI (registrado también en la GCP console).
 */

import { createHmac } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import type { calendar_v3 } from "@googleapis/calendar";
import type { BusyInterval } from "./google-calendar";

// ── Config ──────────────────────────────────────────────────────

function oauthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_CLOSER_REDIRECT_URI,
  );
}

export function closerGoogleCalendarOAuthConfigured(): boolean {
  return oauthConfigured();
}

// ── HMAC state (CSRF) ───────────────────────────────────────────

const STATE_TTL_MS = 10 * 60_000;

function stateSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-fallback-secret";
}

// Prefijo "c:" para que el callback distinga sin ambigüedad de los teacher states.
export function signCloserState(closerId: string): string {
  const ts = Date.now().toString(36);
  const payload = `c:${closerId}:${ts}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 16);
  return `${payload}:${sig}`;
}

export function verifyCloserState(state: string): { closerId: string } | null {
  const parts = state.split(":");
  if (parts.length !== 4 || parts[0] !== "c") return null;
  const [, closerId, ts, sig] = parts;
  const payload = `c:${closerId}:${ts}`;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  const createdAt = parseInt(ts, 36);
  if (Date.now() - createdAt > STATE_TTL_MS) return null;
  return { closerId };
}

// ── OAuth URL + token exchange ──────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function buildCloserOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri:  process.env.GOOGLE_OAUTH_CLOSER_REDIRECT_URI!,
    response_type: "code",
    scope:         SCOPES.join(" "),
    access_type:   "offline",
    prompt:        "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token:  string;
  refresh_token: string;
  expiry_date:   number;
  email:         string | null;
};

export async function exchangeCloserCodeForTokens(code: string): Promise<TokenResponse> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_OAUTH_CLOSER_REDIRECT_URI!,
      grant_type:    "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
  }
  const data = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!data.refresh_token) {
    throw new Error("No refresh_token returned — ensure prompt=consent and access_type=offline");
  }

  let email: string | null = null;
  try {
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (infoRes.ok) {
      const info = await infoRes.json() as { email?: string };
      email = info.email ?? null;
    }
  } catch { /* no-op */ }

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expiry_date:   Date.now() + data.expires_in * 1000,
    email,
  };
}

// ── Storage + refresh ───────────────────────────────────────────

type StoredCreds = {
  access_token:  string;
  refresh_token: string;
  token_expiry:  string;
  calendar_email: string | null;
};

async function getStoredCredentials(closerId: string): Promise<StoredCreds | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("closer_google_credentials")
    .select("access_token, refresh_token, token_expiry, calendar_email")
    .eq("closer_id", closerId)
    .maybeSingle();
  return data as StoredCreds | null;
}

async function refreshAccessToken(closerId: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("invalid_grant")) {
        console.warn(`[gcal-closer] invalid_grant for closer ${closerId} — removing credentials`);
        await disconnectCloserGoogleCalendar(closerId);
        return null;
      }
      console.error(`[gcal-closer] refresh failed: ${res.status} ${text}`);
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    const sb = supabaseAdmin();
    await sb
      .from("closer_google_credentials")
      .update({
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      })
      .eq("closer_id", closerId);
    return data.access_token;
  } catch (e) {
    console.error("[gcal-closer] refresh error:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function getValidAccessToken(closerId: string): Promise<string | null> {
  const creds = await getStoredCredentials(closerId);
  if (!creds) return null;
  const expiry = new Date(creds.token_expiry).getTime();
  const BUFFER_MS = 5 * 60_000;
  if (Date.now() < expiry - BUFFER_MS) {
    return creds.access_token;
  }
  return refreshAccessToken(closerId, creds.refresh_token);
}

async function getCloserCalendarClient(closerId: string): Promise<calendar_v3.Calendar | null> {
  if (!oauthConfigured()) return null;
  const token = await getValidAccessToken(closerId);
  if (!token) return null;
  const { OAuth2Client } = await import("google-auth-library");
  const { calendar } = await import("@googleapis/calendar");
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: token });
  return calendar({ version: "v3", auth });
}

// ── Public API ──────────────────────────────────────────────────

export async function isCloserGoogleCalendarConnected(
  closerId: string,
): Promise<{ connected: boolean; email: string | null }> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("closer_google_credentials")
    .select("calendar_email")
    .eq("closer_id", closerId)
    .maybeSingle();
  if (!data) return { connected: false, email: null };
  return { connected: true, email: (data as { calendar_email: string | null }).calendar_email };
}

export async function disconnectCloserGoogleCalendar(closerId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("closer_google_credentials")
    .select("access_token")
    .eq("closer_id", closerId)
    .maybeSingle();
  if (data) {
    const token = (data as { access_token: string }).access_token;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    } catch { /* non-critical */ }
  }
  await sb.from("closer_google_credentials").delete().eq("closer_id", closerId);
}

export async function upsertCloserGoogleCredentials(
  closerId: string,
  tokens: TokenResponse,
): Promise<void> {
  const sb = supabaseAdmin();
  const row = {
    closer_id:      closerId,
    access_token:   tokens.access_token,
    refresh_token:  tokens.refresh_token,
    token_expiry:   new Date(tokens.expiry_date).toISOString(),
    calendar_email: tokens.email,
  };
  const { error } = await sb
    .from("closer_google_credentials")
    .upsert(row, { onConflict: "closer_id" });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

// ── Event operations ────────────────────────────────────────────

type SesionEventArgs = {
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

/**
 * Crea el evento de la Sesión de Plan-Alemán en el calendar personal del closer.
 * Devuelve `{ eventId }` o `null` si el closer no vinculó calendar o el
 * insert falló — en ambos casos la sesión sigue funcionando, solo se pierde
 * el espejo en GCal.
 */
export async function createCloserSesionEvent(
  closerId: string,
  a: SesionEventArgs,
): Promise<{ eventId: string } | null> {
  const cal = await getCloserCalendarClient(closerId);
  if (!cal) return null;

  const start = new Date(a.startIso);
  const end   = new Date(start.getTime() + a.durationMinutes * 60_000);
  const leadFirst = (a.leadName || "").split(/\s+/)[0] || "Lead";

  const lines: string[] = [
    `Sesión de Plan-Alemán (${a.durationMinutes} min) con ${a.leadName}.`,
    "",
    `Aula: ${a.joinUrl}`,
    a.confirmacionUrl ? `Ficha del lead: ${a.confirmacionUrl}` : null,
    "",
    "—",
    `Lead: ${a.leadName}`,
    a.leadEmail    ? `Email: ${a.leadEmail}` : null,
    a.leadWhatsapp ? `WhatsApp: ${a.leadWhatsapp}` : null,
    a.germanLevel  ? `Nivel: ${a.germanLevel}` : null,
    a.goal         ? `Objetivo: ${a.goal}` : null,
    a.deadline     ? `Plazo: ${a.deadline}` : null,
  ].filter(Boolean) as string[];

  try {
    const res = await cal.events.insert({
      calendarId: "primary",
      requestBody: {
        summary:     `📋 Sesión de Plan-Alemán — ${leadFirst}`,
        description: lines.join("\n"),
        // location = enlace a la videollamada → clic directo desde el evento
        location:    a.joinUrl,
        start: { dateTime: start.toISOString(), timeZone: "Europe/Berlin" },
        end:   { dateTime: end.toISOString(),   timeZone: "Europe/Berlin" },
        reminders: { useDefault: true },
      },
    });
    if (!res.data.id) return null;
    return { eventId: res.data.id };
  } catch (e) {
    console.error(`[gcal-closer] createSesionEvent failed for closer ${closerId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function patchCloserSesionEvent(
  closerId:        string,
  eventId:         string,
  newStartIso:     string,
  durationMinutes: number,
): Promise<boolean> {
  const cal = await getCloserCalendarClient(closerId);
  if (!cal) return false;
  const start = new Date(newStartIso);
  const end   = new Date(start.getTime() + durationMinutes * 60_000);
  try {
    await cal.events.patch({
      calendarId: "primary",
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
      console.warn(`[gcal-closer] patch: event ${eventId} not found (already deleted?)`);
      return false;
    }
    console.error("[gcal-closer] patch failed:", msg);
    return false;
  }
}

// ── FreeBusy con cache in-memory ────────────────────────────────

type BusyCacheEntry = { intervals: BusyInterval[]; expiresAtMs: number };
const closerBusyCache = new Map<string, BusyCacheEntry>();
const CLOSER_BUSY_CACHE_TTL_MS = 60_000;

function closerCacheKey(closerId: string, min: string, max: string): string {
  const round = (iso: string) => {
    const d = new Date(iso);
    const m = d.getUTCMinutes();
    d.setUTCMinutes(m - (m % 5), 0, 0);
    return d.toISOString();
  };
  return `${closerId}:${round(min)}|${round(max)}`;
}

/**
 * Intervalos ocupados del calendar personal del closer entre dos ISOs.
 * Cache de 60s (mismo patrón que teachers). Devuelve [] si el closer no
 * vinculó calendar o la API falla — fail-open para no bloquear el picker.
 */
export async function getCloserCalendarBusy(
  closerId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<BusyInterval[]> {
  const key = closerCacheKey(closerId, timeMinIso, timeMaxIso);
  const now = Date.now();
  const cached = closerBusyCache.get(key);
  if (cached && cached.expiresAtMs > now) return cached.intervals;

  const cal = await getCloserCalendarClient(closerId);
  if (!cal) return [];

  try {
    const res = await cal.freebusy.query({
      requestBody: {
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        items: [{ id: "primary" }],
      },
    });
    const cals = res.data.calendars ?? {};
    const entry = cals["primary"];
    const busy = entry?.busy ?? [];
    const intervals: BusyInterval[] = busy
      .filter(b => b.start && b.end)
      .map(b => ({
        startMs: new Date(b.start as string).getTime(),
        endMs:   new Date(b.end as string).getTime(),
      }));

    closerBusyCache.set(key, { intervals, expiresAtMs: now + CLOSER_BUSY_CACHE_TTL_MS });
    if (closerBusyCache.size > 200) {
      const oldest = [...closerBusyCache.entries()]
        .sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs)[0];
      if (oldest) closerBusyCache.delete(oldest[0]);
    }
    return intervals;
  } catch (e) {
    console.error(`[gcal-closer] freeBusy failed for closer ${closerId}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

export async function deleteCloserSesionEvent(
  closerId: string,
  eventId:  string,
): Promise<boolean> {
  const cal = await getCloserCalendarClient(closerId);
  if (!cal) return false;
  try {
    await cal.events.delete({ calendarId: "primary", eventId });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404") || msg.includes("Resource has been deleted")) {
      return true;
    }
    console.error("[gcal-closer] delete failed:", msg);
    return false;
  }
}
