import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWelcomeStaffEmail } from "@/lib/email/send";

/**
 * POST /api/admin/teachers/[id]/approve
 *
 * Aprueba un profesor que se auto-registró via /profesor/registro.
 * Pasos:
 *   1. Verifica que el teacher existe y está pending
 *      (registered_self=TRUE, approved_at NULL).
 *   2. Genera password temporal nuevo y actualiza users.password_hash.
 *   3. users.active = TRUE  (le permite loguearse).
 *   4. teachers.active = TRUE + approved_at + approved_by.
 *   5. Envía welcome email con el password temporal y link de login.
 *
 * Auth: admin / superadmin.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const adminId = (session.user as { id: string }).id;
  const { id: teacherId } = await params;

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

  // Generar nuevo password temporal (no reutilizamos uno viejo).
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  // Activar user.
  const { error: uErr } = await sb
    .from("users")
    .update({ active: true, password_hash: passwordHash, must_change_password: true })
    .eq("id", u.id);
  if (uErr) {
    return NextResponse.json({ ok: false, error: "user_update_failed", reason: uErr.message }, { status: 500 });
  }

  // Activar teacher + marcar approved.
  const { error: tErr } = await sb
    .from("teachers")
    .update({
      active:       true,
      approved_at:  new Date().toISOString(),
      approved_by:  adminId,
    })
    .eq("id", t.id);
  if (tErr) {
    return NextResponse.json({ ok: false, error: "teacher_update_failed", reason: tErr.message }, { status: 500 });
  }

  // Mandar welcome email con el temp password.
  const firstName = (u.full_name ?? "").trim().split(/\s+/)[0] || (u.full_name ?? "");
  const emailRes = await sendWelcomeStaffEmail(u.email, {
    name:         firstName,
    role:         "teacher",
    email:        u.email,
    tempPassword,
    platformUrl:  PLATFORM_URL,
    language:     u.language_preference ?? "es",
  });

  return NextResponse.json({
    ok:           true,
    teacher_id:   t.id,
    email_sent:   emailRes.ok,
    // En caso de que el email falle, devolvemos el password para que
    // admin pueda comunicárselo manualmente.
    tempPassword: emailRes.ok ? null : tempPassword,
    email_error:  emailRes.ok ? null : ("error" in emailRes ? emailRes.error : "unknown"),
  });
}

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
