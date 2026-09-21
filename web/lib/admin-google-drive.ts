/**
 * Google Drive OAuth del admin — para crear los "Apuntes de Clase" con la
 * cuenta de Gelfis (dueño del documento) en vez de la service account,
 * que desde sept 2026 no tiene almacenamiento en Drive.
 *
 * Reutiliza el OAuth Client y el redirect de closers
 * (GOOGLE_OAUTH_CLOSER_REDIRECT_URI): el callback de closers distingue este
 * flujo por el prefijo "a:" del state. Así no hay que registrar otra URL
 * en Google Cloud.
 */
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "./supabase";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const STATE_TTL_MS = 10 * 60_000;

export function adminDriveOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_CLOSER_REDIRECT_URI,
  );
}

function stateSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-fallback-secret";
}

export function signAdminState(adminId: string): string {
  const ts = Date.now().toString(36);
  const payload = `a:${adminId}:${ts}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 16);
  return `${payload}:${sig}`;
}

export function verifyAdminState(state: string): { adminId: string } | null {
  const parts = state.split(":");
  if (parts.length !== 4 || parts[0] !== "a") return null;
  const [, adminId, ts, sig] = parts;
  const expected = createHmac("sha256", stateSecret()).update(`a:${adminId}:${ts}`).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  if (Date.now() - parseInt(ts, 36) > STATE_TTL_MS) return null;
  return { adminId };
}

export function buildAdminDriveOAuthUrl(state: string): string {
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

export async function upsertAdminGoogleCredentials(
  adminId: string,
  tokens: { access_token: string; refresh_token: string; expiry_date: number; email: string | null },
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("admin_google_credentials").upsert({
    admin_id:      adminId,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expiry:  new Date(tokens.expiry_date).toISOString(),
    google_email:  tokens.email,
    scope:         SCOPES.join(" "),
  }, { onConflict: "admin_id" });
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

export async function adminDriveStatus(): Promise<{ connected: boolean; email: string | null; since: string | null }> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("admin_google_credentials")
    .select("google_email, connected_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const d = data as { google_email: string | null; connected_at: string } | null;
  return d ? { connected: true, email: d.google_email, since: d.connected_at } : { connected: false, email: null, since: null };
}

/** Access token válido de cualquier admin conectado (refresca si caducó). */
export async function getAdminDriveAccessToken(): Promise<string | null> {
  if (!adminDriveOAuthConfigured()) return null;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("admin_google_credentials")
    .select("admin_id, access_token, refresh_token, token_expiry")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const creds = data as { admin_id: string; access_token: string; refresh_token: string; token_expiry: string } | null;
  if (!creds) return null;

  if (Date.now() < new Date(creds.token_expiry).getTime() - 5 * 60_000) return creds.access_token;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        refresh_token: creds.refresh_token,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("invalid_grant")) {
        console.warn("[admin-drive] invalid_grant — eliminando credenciales; el admin debe reconectar");
        await sb.from("admin_google_credentials").delete().eq("admin_id", creds.admin_id);
      } else {
        console.error(`[admin-drive] refresh failed: ${res.status} ${text}`);
      }
      return null;
    }
    const d = await res.json() as { access_token: string; expires_in: number };
    await sb.from("admin_google_credentials")
      .update({ access_token: d.access_token, token_expiry: new Date(Date.now() + d.expires_in * 1000).toISOString() })
      .eq("admin_id", creds.admin_id);
    return d.access_token;
  } catch (e) {
    console.error("[admin-drive] refresh error:", e instanceof Error ? e.message : e);
    return null;
  }
}
