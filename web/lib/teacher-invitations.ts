/**
 * Helpers para teacher_invitations — invitaciones que el admin envía
 * por email (o comparte por link) a candidatos a profesor para que se
 * auto-registren via /registro-profesor?code=XXX.
 *
 * Reglas (rediseño 2026-08-02):
 *   - TTL 14 días desde la creación.
 *   - Single-use: la primera persona que envíe el form lo consume.
 *   - El admin fija las condiciones al invitar (tarifa individual,
 *     rango de comisión, accepts_trials) — se aplican al perfil al
 *     completarse el registro y el profe NUNCA las edita.
 *   - Admin puede revocar y reenviar.
 *   - El código es URL-safe (base62 ≈ 16 chars).
 */
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

const CODE_LEN  = 16;
const ALPHABET  = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export type TeacherRango = "starter" | "pro" | "elite" | "master";

export type TeacherInvitation = {
  id:                  string;
  code:                string;
  email:               string | null;
  name:                string | null;
  notes:               string | null;
  rate_individual_eur: number | null;
  rango:               TeacherRango;
  accepts_trials:      boolean;
  created_by:          string | null;
  created_at:          string;
  expires_at:          string;
  used_at:             string | null;
  used_by_user_id:     string | null;
  revoked_at:          string | null;
  last_sent_at:        string | null;
};

export type InvitationStatus = "pendiente" | "completada" | "expirada" | "revocada";

export function invitationStatus(inv: TeacherInvitation): InvitationStatus {
  if (inv.used_at) return "completada";
  if (inv.revoked_at) return "revocada";
  if (new Date(inv.expires_at).getTime() < Date.now()) return "expirada";
  return "pendiente";
}

export type ValidationResult =
  | { ok: true;  invitation: TeacherInvitation }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "revoked" };

/**
 * Crea una invitación nueva con las condiciones acordadas y devuelve
 * la URL completa lista para el email o para copiar.
 */
export async function createInvitation(opts: {
  createdBy:      string;
  email:          string;
  name?:          string | null;
  notes?:         string | null;
  rateIndividual: number;
  rango?:         TeacherRango;
  acceptsTrials?: boolean;
}): Promise<{ invitation: TeacherInvitation; url: string }> {
  const sb = supabaseAdmin();
  const code = generateCode();
  const { data, error } = await sb
    .from("teacher_invitations")
    .insert({
      code,
      email:               opts.email.trim().toLowerCase(),
      name:                opts.name?.trim() || null,
      notes:               opts.notes ?? null,
      rate_individual_eur: opts.rateIndividual,
      rango:               opts.rango ?? "starter",
      accepts_trials:      opts.acceptsTrials ?? false,
      created_by:          opts.createdBy,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`teacher_invitations insert failed: ${error?.message ?? "unknown"}`);
  }
  const inv = data as TeacherInvitation;
  return { invitation: inv, url: buildInvitationUrl(inv.code) };
}

/**
 * Valida un código de invitación sin consumirlo. Útil para
 * /registro-profesor?code=... que sólo necesita saber si renderiza
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
 * Lista invitaciones recientes (todas: pendientes, completadas,
 * expiradas, revocadas) para la tabla del panel admin. El estado se
 * deriva con invitationStatus().
 */
export async function listInvitations(limit = 50): Promise<TeacherInvitation[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_invitations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
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

/** Registra el envío del email de invitación (creación o reenvío). */
export async function markInvitationSent(id: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("teacher_invitations")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Reenvío: si la invitación expiró, extiende la validez 14 días más
 * desde ahora (mismo código — el candidato conserva el mismo link).
 */
export async function extendInvitationExpiry(id: string): Promise<TeacherInvitation | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teacher_invitations")
    .update({ expires_at: new Date(Date.now() + 14 * 24 * 3600_000).toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();
  return (data as TeacherInvitation | null) ?? null;
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
  return `${base}/registro-profesor?code=${encodeURIComponent(code)}`;
}
