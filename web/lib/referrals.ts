import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";
import { createNotification } from "./notifications";
import { sendWhatsappText } from "./whatsapp";

/**
 * Sistema de referidos "Regala una clase — gana 3" (Gelfis 2026-08-14).
 *
 * B2C es el dueño: códigos, atribución, recompensas. SCHULE solo
 * consume vía /api/internal/student/referral.
 *
 * Reglas:
 *   - Código corto legible por estudiante (PREFIJO-4CHARS), lazy.
 *   - Atribución first-touch en leads.referred_by (nunca sobrescribe).
 *   - Recompensa al CONVERTIR: +3 clases al referidor, +1 al nuevo.
 *   - Idempotencia dura: UPDATE ... WHERE referral_rewarded_at IS NULL.
 *   - Auto-referidos bloqueados (mismo email o whatsapp que el referidor).
 *   - Las clases regaladas son bonus: no comisionan ni cuentan como venta.
 */

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";  // sin 0/O/1/I/L

const PLATFORM_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function randomSuffix(len = 4): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** GELF-3F2K a partir del nombre (prefijo A-Z de 3-5 chars) + 4 random. */
function buildCode(fullName: string | null): string {
  const prefix = (fullName ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // quitar tildes
    .toUpperCase().replace(/[^A-Z]/g, "")
    .slice(0, 4) || "ALEM";
  return `${prefix}-${randomSuffix()}`;
}

export function buildReferralLink(code: string): string {
  return `${PLATFORM_URL}/?ref=${encodeURIComponent(code)}`;
}

/** Devuelve el código del estudiante, generándolo si aún no existe. */
export async function getOrCreateReferralCode(studentId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data: st } = await sb
    .from("students")
    .select("id, referral_code, users!inner(full_name)")
    .eq("id", studentId)
    .maybeSingle();
  if (!st) return null;
  const row = st as { referral_code: string | null; users: { full_name: string | null } | Array<{ full_name: string | null }> };
  if (row.referral_code) return row.referral_code;

  const u = Array.isArray(row.users) ? row.users[0] : row.users;
  // Reintentos por colisión del sufijo random (unique constraint).
  for (let i = 0; i < 5; i++) {
    const code = buildCode(u?.full_name ?? null);
    const { data, error } = await sb
      .from("students")
      .update({ referral_code: code })
      .eq("id", studentId)
      .is("referral_code", null)      // race-guard: otro request pudo ganarnos
      .select("referral_code")
      .maybeSingle();
    if (!error && data) return (data as { referral_code: string }).referral_code;
    if (!error && !data) {
      // Otro request lo generó entre el select y el update — releer.
      const { data: again } = await sb.from("students").select("referral_code").eq("id", studentId).maybeSingle();
      return (again as { referral_code: string | null } | null)?.referral_code ?? null;
    }
    // error → probablemente colisión unique; probar otro sufijo
  }
  return null;
}

export type ReferralInfo = {
  studentId: string;
  firstName: string;
};

/** Resuelve un código → referidor. null si no existe (sin error). */
export async function resolveReferralCode(code: string): Promise<ReferralInfo | null> {
  const clean = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(clean)) return null;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("students")
    .select("id, users!inner(full_name)")
    .eq("referral_code", clean)
    .maybeSingle();
  if (!data) return null;
  const u0 = (data as { users: unknown }).users;
  const u = (Array.isArray(u0) ? u0[0] : u0) as { full_name: string | null } | null;
  const firstName = (u?.full_name ?? "").trim().split(/\s+/)[0] || "Un amigo";
  return { studentId: (data as { id: string }).id, firstName };
}

export type ReferralStats = {
  code:           string | null;
  link:           string | null;
  invited_count:  number;
  converted_count: number;
  classes_earned: number;
};

export async function referralStats(studentId: string): Promise<ReferralStats> {
  const sb = supabaseAdmin();
  const { data: st } = await sb
    .from("students")
    .select("referral_code")
    .eq("id", studentId)
    .maybeSingle();
  const code = (st as { referral_code: string | null } | null)?.referral_code ?? null;

  const { count: invited } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", studentId);

  const { count: rewarded } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", studentId)
    .not("referral_rewarded_at", "is", null);

  return {
    code,
    link: code ? buildReferralLink(code) : null,
    invited_count:   invited ?? 0,
    converted_count: rewarded ?? 0,
    classes_earned:  (rewarded ?? 0) * 3,
  };
}

/**
 * Atribuye un lead a un referidor (first-touch). Llamar desde
 * book-trial cuando llega ?ref. No sobrescribe una atribución previa.
 * Bloquea auto-referidos por email/whatsapp.
 */
export async function attributeReferral(opts: {
  leadId:    string;
  code:      string;
  leadEmail?: string | null;
  leadWhatsapp?: string | null;
}): Promise<{ attributed: boolean; reason?: string }> {
  const sb = supabaseAdmin();
  const ref = await resolveReferralCode(opts.code);
  if (!ref) return { attributed: false, reason: "invalid_code" };

  // Anti auto-referido: comparar email/whatsapp del lead con los del
  // usuario del referidor.
  const { data: refUser } = await sb
    .from("students")
    .select("users!inner(email, phone)")
    .eq("id", ref.studentId)
    .maybeSingle();
  const ru0 = (refUser as { users: unknown } | null)?.users;
  const ru = (Array.isArray(ru0) ? ru0[0] : ru0) as { email: string | null; phone: string | null } | null;
  const sameEmail = !!opts.leadEmail && !!ru?.email && opts.leadEmail.toLowerCase() === ru.email.toLowerCase();
  const samePhone = !!opts.leadWhatsapp && !!ru?.phone &&
    opts.leadWhatsapp.replace(/\D/g, "") === ru.phone.replace(/\D/g, "");
  if (sameEmail || samePhone) return { attributed: false, reason: "self_referral" };

  // First-touch: solo si aún no tiene referidor.
  const { data: updated } = await sb
    .from("leads")
    .update({ referred_by: ref.studentId })
    .eq("id", opts.leadId)
    .is("referred_by", null)
    .select("id")
    .maybeSingle();

  if (!updated) return { attributed: false, reason: "already_attributed" };

  await sb.from("lead_timeline").insert({
    lead_id: opts.leadId,
    type:    "status_change",
    author:  "system",
    content: `🎁 Lead referido por ${ref.firstName} (código ${opts.code.toUpperCase()})`,
    metadata: { kind: "referral_attributed", referrer_student_id: ref.studentId, code: opts.code.toUpperCase() },
  }).then(() => {}, () => {});

  return { attributed: true };
}

/**
 * Aplica la recompensa del referido tras la CONVERSIÓN del lead.
 * Idempotente (una sola vez por lead) y best-effort en notificaciones.
 * Llamar desde los 3 caminos de conversión.
 */
export async function applyReferralReward(leadId: string): Promise<{
  rewarded: boolean;
  reason?: string;
}> {
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, referred_by, referral_rewarded_at, converted_to_user_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { rewarded: false, reason: "lead_not_found" };
  const ld = lead as {
    id: string; name: string | null; email: string | null; whatsapp_normalized: string | null;
    referred_by: string | null; referral_rewarded_at: string | null; converted_to_user_id: string | null;
  };
  if (!ld.referred_by) return { rewarded: false, reason: "not_referred" };
  if (!ld.converted_to_user_id) return { rewarded: false, reason: "not_converted" };

  // ── Lock de idempotencia: solo un caller gana este UPDATE ──────────
  const { data: locked } = await sb
    .from("leads")
    .update({ referral_rewarded_at: new Date().toISOString() })
    .eq("id", leadId)
    .is("referral_rewarded_at", null)
    .select("id")
    .maybeSingle();
  if (!locked) return { rewarded: false, reason: "already_rewarded" };

  // Datos del referidor
  const { data: referrer } = await sb
    .from("students")
    .select("id, clases_desbloqueadas, user_id, users!inner(full_name, email, phone)")
    .eq("id", ld.referred_by)
    .maybeSingle();
  if (!referrer) return { rewarded: false, reason: "referrer_not_found" };
  const rf = referrer as {
    id: string; clases_desbloqueadas: number | null; user_id: string;
    users: { full_name: string | null; email: string | null; phone: string | null } | Array<{ full_name: string | null; email: string | null; phone: string | null }>;
  };
  const rfu = Array.isArray(rf.users) ? rf.users[0] : rf.users;

  // Guard tardío anti auto-referido (por si la atribución vieja se coló)
  const sameEmail = !!ld.email && !!rfu?.email && ld.email.toLowerCase() === rfu.email.toLowerCase();
  const samePhone = !!ld.whatsapp_normalized && !!rfu?.phone &&
    ld.whatsapp_normalized.replace(/\D/g, "") === rfu.phone.replace(/\D/g, "");
  if (sameEmail || samePhone) return { rewarded: false, reason: "self_referral" };

  const friendFirst = (ld.name ?? "tu amigo").trim().split(/\s+/)[0] || "tu amigo";

  // (a) +3 clases al REFERIDOR
  await sb.from("students")
    .update({ clases_desbloqueadas: (rf.clases_desbloqueadas ?? 0) + 3 })
    .eq("id", rf.id);

  // (b) +1 clase al NUEVO estudiante
  const { data: newStudent } = await sb
    .from("students")
    .select("id, clases_desbloqueadas")
    .eq("user_id", ld.converted_to_user_id)
    .maybeSingle();
  if (newStudent) {
    const ns = newStudent as { id: string; clases_desbloqueadas: number | null };
    await sb.from("students")
      .update({ clases_desbloqueadas: (ns.clases_desbloqueadas ?? 0) + 1 })
      .eq("id", ns.id);
  }

  // (c) Notificaciones al referidor — celebración
  const celebration = `🎁 ¡${friendFirst} se inscribió con tu enlace! Tus 3 clases de regalo ya están en tu cuenta.`;
  await createNotification({
    user_id: rf.user_id,
    type:    "referral_reward",
    title:   "¡Tus 3 clases de regalo ya están aquí!",
    body:    celebration,
    link:    "/estudiante",
  }).catch(() => null);
  if (rfu?.phone) {
    await sendWhatsappText(rfu.phone, celebration + "\n\n— Aprender-Aleman.de", { kind: "referral_reward" })
      .catch(() => null);
  }

  // (d) Timeline en ambos
  const now = new Date().toISOString();
  await sb.from("lead_timeline").insert({
    lead_id: ld.id,
    type:    "status_change",
    author:  "system",
    content: `🎁 Recompensa de referido aplicada — +3 clases a ${rfu?.full_name ?? "el referidor"}, +1 clase extra a ${friendFirst}. (Bonus: no comisiona ni cuenta como venta.)`,
    metadata: { kind: "referral_rewarded", referrer_student_id: rf.id, rewarded_at: now },
  }).then(() => {}, () => {});

  return { rewarded: true };
}
