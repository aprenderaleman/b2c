/**
 * Google Calendar OAuth — per-teacher personal calendar integration.
 *
 * Each teacher can connect their own Google Calendar via OAuth 2.0.
 * This module handles:
 *   - Building the OAuth consent URL
 *   - Exchanging authorization codes for tokens
 *   - Auto-refreshing expired access tokens
 *   - Creating trial class events in the teacher's calendar
 *   - Querying freeBusy intervals (with in-memory cache)
 *
 * Env vars required:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI
 *
 * All functions are env-gated: if the vars are missing, they return
 * null/[] silently so dev/preview keeps working.
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
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export function googleCalendarOAuthConfigured(): boolean {
  return oauthConfigured();
}

// ── HMAC state for CSRF protection ──────────────────────────────

const STATE_TTL_MS = 10 * 60_000; // 10 minutes

function stateSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-fallback-secret";
}

export function signState(teacherId: string): string {
  const ts = Date.now().toString(36);
  const payload = `${teacherId}:${ts}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 16);
  return `${payload}:${sig}`;
}

export function verifyState(state: string): { teacherId: string } | null {
  const parts = state.split(":");
  if (parts.length !== 3) return null;
  const [teacherId, ts, sig] = parts;
  const payload = `${teacherId}:${ts}`;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  const createdAt = parseInt(ts, 36);
  if (Date.now() - createdAt > STATE_TTL_MS) return null;
  return { teacherId };
}

// ── OAuth URL + token exchange ──────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function buildGoogleOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri:  process.env.GOOGLE_OAUTH_REDIRECT_URI!,
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

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_OAUTH_REDIRECT_URI!,
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
  } catch {
    // Non-critical
  }

  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expiry_date:   Date.now() + data.expires_in * 1000,
    email,
  };
}

// ── Token storage + auto-refresh ────────────────────────────────

type StoredCreds = {
  access_token:  string;
  refresh_token: string;
  token_expiry:  string;
  calendar_email: string | null;
};

async function getStoredCredentials(teacherId: string): Promise<StoredCreds | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_google_credentials")
    .select("access_token, refresh_token, token_expiry, calendar_email")
    .eq("teacher_id", teacherId)
    .maybeSingle();
  return data as StoredCreds | null;
}

async function refreshAccessToken(teacherId: string, refreshToken: string): Promise<string | null> {
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
        console.warn(`[gcal-oauth] invalid_grant for teacher ${teacherId} — removing credentials`);
        await disconnectTeacherGoogleCalendar(teacherId);
        return null;
      }
      console.error(`[gcal-oauth] refresh failed: ${res.status} ${text}`);
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    const sb = supabaseAdmin();
    await sb
      .from("teacher_google_credentials")
      .update({
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      })
      .eq("teacher_id", teacherId);
    return data.access_token;
  } catch (e) {
    console.error("[gcal-oauth] refresh error:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function getValidAccessToken(teacherId: string): Promise<string | null> {
  const creds = await getStoredCredentials(teacherId);
  if (!creds) return null;

  const expiry = new Date(creds.token_expiry).getTime();
  const BUFFER_MS = 5 * 60_000; // refresh 5 min before expiry
  if (Date.now() < expiry - BUFFER_MS) {
    return creds.access_token;
  }
  return refreshAccessToken(teacherId, creds.refresh_token);
}

async function getTeacherCalendarClient(teacherId: string): Promise<calendar_v3.Calendar | null> {
  if (!oauthConfigured()) return null;
  const token = await getValidAccessToken(teacherId);
  if (!token) return null;

  const { OAuth2Client } = await import("google-auth-library");
  const { calendar } = await import("@googleapis/calendar");
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: token });
  return calendar({ version: "v3", auth });
}

// ── Public API ──────────────────────────────────────────────────

export async function isTeacherGoogleCalendarConnected(
  teacherId: string,
): Promise<{ connected: boolean; email: string | null }> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_google_credentials")
    .select("calendar_email")
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!data) return { connected: false, email: null };
  return { connected: true, email: (data as { calendar_email: string | null }).calendar_email };
}

export async function disconnectTeacherGoogleCalendar(teacherId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_google_credentials")
    .select("access_token")
    .eq("teacher_id", teacherId)
    .maybeSingle();

  if (data) {
    // Best-effort revoke
    const token = (data as { access_token: string }).access_token;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    } catch { /* non-critical */ }
  }

  await sb.from("teacher_google_credentials").delete().eq("teacher_id", teacherId);
}

export async function upsertTeacherGoogleCredentials(
  teacherId: string,
  tokens: TokenResponse,
): Promise<void> {
  const sb = supabaseAdmin();
  const row = {
    teacher_id:     teacherId,
    access_token:   tokens.access_token,
    refresh_token:  tokens.refresh_token,
    token_expiry:   new Date(tokens.expiry_date).toISOString(),
    calendar_email: tokens.email,
  };
  const { error } = await sb
    .from("teacher_google_credentials")
    .upsert(row, { onConflict: "teacher_id" });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

// ── Calendar operations ─────────────────────────────────────────

type TeacherTrialEventArgs = {
  leadName:        string;
  teacherName:     string;
  startIso:        string;
  durationMinutes: number;
  leadEmail:       string | null;
  leadWhatsapp:    string | null;
  germanLevel:     string | null;
  goal:            string | null;
  joinUrl:         string;
};

export async function createTeacherTrialEvent(
  teacherId: string,
  a: TeacherTrialEventArgs,
): Promise<{ eventId: string } | null> {
  const cal = await getTeacherCalendarClient(teacherId);
  if (!cal) return null;

  const start = new Date(a.startIso);
  const end = new Date(start.getTime() + a.durationMinutes * 60_000);
  const leadFirst = (a.leadName || "").split(/\s+/)[0] || "Lead";

  const lines: string[] = [
    `Clase de prueba con ${a.leadName}`,
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
      calendarId: "primary",
      requestBody: {
        summary:     `${leadFirst} — Clase de Prueba`,
        description: lines.join("\n"),
        start: { dateTime: start.toISOString(), timeZone: "Europe/Berlin" },
        end:   { dateTime: end.toISOString(),   timeZone: "Europe/Berlin" },
        reminders: { useDefault: true },
      },
    });
    if (!res.data.id) return null;
    return { eventId: res.data.id };
  } catch (e) {
    console.error(`[gcal-oauth] createTeacherTrialEvent failed for teacher ${teacherId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── FreeBusy with cache ─────────────────────────────────────────

type BusyCacheEntry = { intervals: BusyInterval[]; expiresAtMs: number };
const teacherBusyCache = new Map<string, BusyCacheEntry>();
const TEACHER_BUSY_CACHE_TTL_MS = 60_000;

function teacherCacheKey(teacherId: string, min: string, max: string): string {
  const round = (iso: string) => {
    const d = new Date(iso);
    const m = d.getUTCMinutes();
    d.setUTCMinutes(m - (m % 5), 0, 0);
    return d.toISOString();
  };
  return `${teacherId}:${round(min)}|${round(max)}`;
}

export async function getTeacherCalendarBusy(
  teacherId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<BusyInterval[]> {
  const key = teacherCacheKey(teacherId, timeMinIso, timeMaxIso);
  const now = Date.now();
  const cached = teacherBusyCache.get(key);
  if (cached && cached.expiresAtMs > now) return cached.intervals;

  const cal = await getTeacherCalendarClient(teacherId);
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

    teacherBusyCache.set(key, { intervals, expiresAtMs: now + TEACHER_BUSY_CACHE_TTL_MS });
    if (teacherBusyCache.size > 200) {
      const oldest = [...teacherBusyCache.entries()]
        .sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs)[0];
      if (oldest) teacherBusyCache.delete(oldest[0]);
    }
    return intervals;
  } catch (e) {
    console.error(`[gcal-oauth] freeBusy failed for teacher ${teacherId}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ── Batch helpers ───────────────────────────────────────────────

export async function getConnectedTeacherIds(teacherIds: string[]): Promise<string[]> {
  if (teacherIds.length === 0) return [];
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_google_credentials")
    .select("teacher_id")
    .in("teacher_id", teacherIds);
  return (data ?? []).map(r => (r as { teacher_id: string }).teacher_id);
}
