/**
 * Helpers para teacher_invitations — códigos one-shot que el admin
 * genera y comparte con candidatos a profesor para que se auto-
 * registren via /profesor/registro?code=XXX.
 *
 * Reglas:
 *   - TTL 7 días desde la creación.
 *   - Single-use: la primera persona que envíe el form lo consume.
 *   - Admin puede revocar manualmente con `revokeInvitation()`.
 *   - El código es URL-safe (base62 ≈ 16 chars).
 */
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

const CODE_LEN  = 16;
const ALPHABET  = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export type TeacherInvitation = {
  id:              string;
  code:            string;
  email:           string | null;
  notes:           string | null;
  created_by:      string | null;
  created_at:      string;
  expires_at:      string;
  used_at:         string | null;
  used_by_user_id: string | null;
  revoked_at:      string | null;
};

export type ValidationResult =
  | { ok: true;  invitation: TeacherInvitation }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "revoked" };

/**
 * Crea una invitación nueva y devuelve la URL completa lista para
 * pegar en WhatsApp/email al candidato.
 */
export async function createInvitation(opts: {
  createdBy: string;
  email?:    string | null;
  notes?:    string | null;
}): Promise<{ invitation: TeacherInvitation; url: string }> {
  const sb = supabaseAdmin();
  const code = generateCode();
  const { data, error } = await sb
    .from("teacher_invitations")
    .insert({
      code,
      email:      opts.email   ?? null,
      notes:      opts.notes   ?? null,
      created_by: opts.createdBy,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`teacher_invitations insert failed: ${error?.message ?? "unknown"}`);
  }
  const inv = data as TeacherInvitation;
  const base = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  return {
    invitation: inv,
    url:        `${base}/profesor/registro?code=${encodeURIComponent(inv.code)}`,
  };
}

/**
 * Valida un código de invitación sin consumirlo. Útil para
 * /profesor/registro?code=... que sólo necesita saber si renderiza
 * el formulario o el error "link no válido".
 */
export async function validateInvitation(code: string): Promise<ValidationResult> {
  if (!code || code.length < 8 || code.length > 64) {
    return { ok: false, reason: "not_found" };
  }
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_invitations")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!data) return { ok: false, reason: "not_found" };
  const inv = data as TeacherInvitation;
  if (inv.revoked_at) return { ok: false, reason: "revoked" };
  if (inv.used_at)    return { ok: false, reason: "already_used" };
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, invitation: inv };
}

/**
 * Marca la invitación como consumida. Llamarlo SOLO después de
 * crear exitosamente al usuario. Pasa el userId del recién creado
 * para auditar quién la usó.
 *
 * Race-guard: el UPDATE incluye `used_at IS NULL` en el WHERE — si
 * dos requests intentan consumir el mismo código al mismo tiempo,
 * solo uno cambia 1 fila. El otro recibe 0 y debe rollback su user.
 */
export async function consumeInvitation(
  code:   string,
  userId: string,
): Promise<{ ok: boolean }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teacher_invitations")
    .update({ used_at: new Date().toISOString(), used_by_user_id: userId })
    .eq("code", code)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (error) {
    throw new Error(`consumeInvitation failed: ${error.message}`);
  }
  return { ok: (data ?? []).length === 1 };
}

/**
 * Lista invitaciones activas (no usadas, no revocadas, no expiradas).
 * Usado por el panel admin para ver qué links están pendientes.
 */
export async function listActiveInvitations(): Promise<TeacherInvitation[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_invitations")
    .select("*")
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return (data ?? []) as TeacherInvitation[];
}

/** Invalida manualmente una invitación pendiente. */
export async function revokeInvitation(id: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("teacher_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null);
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Construye la URL pública a partir de un código existente.
 * Útil en UI listings donde solo tenemos el row.
 */
export function buildInvitationUrl(code: string): string {
  const base = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  return `${base}/profesor/registro?code=${encodeURIComponent(code)}`;
}
