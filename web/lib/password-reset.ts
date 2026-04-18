import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

const TOKEN_BYTES = 32;              // 256 bits of entropy → 43 base64url chars
const EXPIRY_HOURS = 1;              // how long a reset link stays valid

/**
 * Request a password reset for the given email. Always returns the same
 * shape regardless of whether the email exists — this avoids leaking
 * account existence to an attacker. Caller sends the email IF
 * `resetUrl` is non-null.
 */
export async function issuePasswordResetToken(
  email: string,
  baseUrl: string,
  requestedIp: string | null,
): Promise<{
  user: { id: string; email: string; full_name: string | null; language_preference: "es" | "de" } | null;
  resetUrl: string | null;
  expiresInHours: number;
}> {
  const sb = supabaseAdmin();
  const normalized = email.trim().toLowerCase();

  const { data: user } = await sb
    .from("users")
    .select("id, email, full_name, language_preference, active")
    .eq("email", normalized)
    .maybeSingle();

  if (!user || !(user as { active: boolean }).active) {
    return { user: null, resetUrl: null, expiresInHours: EXPIRY_HOURS };
  }

  const rawToken  = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000).toISOString();

  const { error } = await sb.from("password_reset_tokens").insert({
    user_id:      (user as { id: string }).id,
    token_hash:   tokenHash,
    expires_at:   expiresAt,
    requested_ip: requestedIp,
  });
  if (error) throw new Error(`token insert failed: ${error.message}`);

  const base = baseUrl.replace(/\/$/, "");
  const resetUrl = `${base}/reset-password?token=${rawToken}`;

  return {
    user: {
      id:                  (user as { id: string }).id,
      email:               (user as { email: string }).email,
      full_name:           (user as { full_name: string | null }).full_name,
      language_preference: (user as { language_preference: "es" | "de" }).language_preference,
    },
    resetUrl,
    expiresInHours: EXPIRY_HOURS,
  };
}

/**
 * Consume a raw reset token: verify it's valid + unused + unexpired,
 * set the user's new password, mark the token as used. Returns the
 * user's email on success (useful for the UX "signed in as…" message).
 */
export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: "not_found" | "expired" | "already_used" | "invalid_password" }> {
  if (newPassword.length < 8) return { ok: false, reason: "invalid_password" };

  const sb = supabaseAdmin();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const { data: row } = await sb
    .from("password_reset_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  if ((row as { used_at: string | null }).used_at) return { ok: false, reason: "already_used" };
  if (new Date((row as { expires_at: string }).expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  // Update the user's password, mark token used.
  const { error: userErr } = await sb
    .from("users")
    .update({
      password_hash:        newHash,
      must_change_password: false,
    })
    .eq("id", (row as { user_id: string }).user_id);
  if (userErr) throw new Error(`password update failed: ${userErr.message}`);

  await sb
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", (row as { id: string }).id);

  const { data: user } = await sb
    .from("users")
    .select("email")
    .eq("id", (row as { user_id: string }).user_id)
    .maybeSingle();

  return { ok: true, email: (user?.email as string) ?? "" };
}
