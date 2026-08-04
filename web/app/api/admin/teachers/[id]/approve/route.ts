import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTeacherWelcomeSetPasswordEmail } from "@/lib/email/send";

/**
 * POST /api/admin/teachers/[id]/approve
 *
 * Aprueba un profesor que se auto-registró via /registro-profesor.
 * Pasos:
 *   1. Verifica que el teacher existe y está pending
 *      (registered_self=TRUE, approved_at NULL).
 *   2. users.active = TRUE  (le permite loguearse).
 *   3. teachers.active = TRUE + approved_at + approved_by.
 *   4. Genera token de creación de contraseña (7 días) y envía
 *      welcome email con el enlace — NO contraseña temporal en texto
 *      (rediseño Gelfis 2026-08-02).
 *
 * Auth: admin / superadmin.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const SETPW_TOKEN_DAYS = 7;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const adminId = (session.user as { id: string }).id;
  const { id: teacherId } = await params;

  // Body opcional: rate_individual y rate_group (€/h) — override del
  // admin en el momento de aprobar (normalmente ya vienen fijadas por
  // la invitación).
  let rateOverride: { rate_individual?: number; rate_group?: number } = {};
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try { rateOverride = await req.json(); } catch { /* no body */ }
  }

  const sb = supabaseAdmin();
  const { data: teacher } = await sb
    .from("teachers")
    .select(`
      id, user_id, registered_self, approved_at,
      users!inner(id, email, full_name, language_preference, active)
    `)
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher) {
    return NextResponse.json({ ok: false, error: "teacher_not_found" }, { status: 404 });
  }
  const t = teacher as {
    id: string; user_id: string; registered_self: boolean; approved_at: string | null;
    users: { id: string; email: string; full_name: string | null;
             language_preference: "es" | "de" | null; active: boolean } |
           Array<{ id: string; email: string; full_name: string | null;
                   language_preference: "es" | "de" | null; active: boolean }>;
  };
  const u = Array.isArray(t.users) ? t.users[0] : t.users;
  if (!t.registered_self || t.approved_at) {
    return NextResponse.json(
      { ok: false, error: "not_pending", message: "Este profesor no está pendiente de aprobación." },
      { status: 409 },
    );
  }

  // Activar user. Sin password temporal — creará la suya vía el enlace.
  const { error: uErr } = await sb
    .from("users")
    .update({ active: true })
    .eq("id", u.id);
  if (uErr) {
    return NextResponse.json({ ok: false, error: "user_update_failed", reason: uErr.message }, { status: 500 });
  }

  // Activar teacher + marcar approved + tarifas override si vinieron.
  // El sistema de payroll lee rate_*_cents, así que escribimos ambos
  // sets: hourly_rate_* (€ NUMERIC legacy) y rate_*_cents (INTEGER).
  const teacherUpdate: Record<string, unknown> = {
    active:       true,
    approved_at:  new Date().toISOString(),
    approved_by:  adminId,
  };
  if (Number.isFinite(rateOverride.rate_individual) && (rateOverride.rate_individual as number) > 0) {
    teacherUpdate.hourly_rate            = rateOverride.rate_individual;
    teacherUpdate.hourly_rate_individual = rateOverride.rate_individual;
    teacherUpdate.rate_individual_cents  = Math.round((rateOverride.rate_individual as number) * 100);
  }
  if (Number.isFinite(rateOverride.rate_group) && (rateOverride.rate_group as number) > 0) {
    teacherUpdate.hourly_rate_group = rateOverride.rate_group;
    teacherUpdate.rate_group_cents  = Math.round((rateOverride.rate_group as number) * 100);
  }
  const { error: tErr } = await sb
    .from("teachers")
    .update(teacherUpdate)
    .eq("id", t.id);
  if (tErr) {
    return NextResponse.json({ ok: false, error: "teacher_update_failed", reason: tErr.message }, { status: 500 });
  }

  // Token de creación de contraseña — misma tabla y pantalla que el
  // reset (/reset-password?token=...), pero con validez de 7 días en
  // vez de 1h porque es un email de bienvenida, no un reset urgente.
  const rawToken  = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { error: tokErr } = await sb.from("password_reset_tokens").insert({
    user_id:      u.id,
    token_hash:   tokenHash,
    expires_at:   new Date(Date.now() + SETPW_TOKEN_DAYS * 24 * 3600_000).toISOString(),
    requested_ip: null,
  });
  if (tokErr) {
    return NextResponse.json({ ok: false, error: "token_insert_failed", reason: tokErr.message }, { status: 500 });
  }
  const setPasswordUrl = `${PLATFORM_URL}/reset-password?token=${rawToken}`;

  const firstName = (u.full_name ?? "").trim().split(/\s+/)[0] || (u.full_name ?? "");
  const emailRes = await sendTeacherWelcomeSetPasswordEmail(u.email, {
    name:           firstName,
    email:          u.email,
    setPasswordUrl,
    validDays:      SETPW_TOKEN_DAYS,
    language:       u.language_preference ?? "es",
  });

  return NextResponse.json({
    ok:           true,
    teacher_id:   t.id,
    email_sent:   emailRes.ok,
    // Si el email falla, devolvemos el enlace para que el admin pueda
    // pasárselo manualmente (WhatsApp etc).
    set_password_url: emailRes.ok ? null : setPasswordUrl,
    email_error:  emailRes.ok ? null : ("error" in emailRes ? emailRes.error : "unknown"),
  });
}
