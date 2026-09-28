import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTeacherOnboardingFunnelEmail } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const SETPW_TOKEN_DAYS = 7;

/**
 * POST /api/admin/teachers/[id]/send-onboarding   ([id] = teachers.id)
 *
 * Email de acceso para un profe que entra en la campaña /clase-profe:
 * enlace de creación de contraseña (7 días, misma tabla/pantalla que el
 * reset) + pasos de disponibilidad y Google Calendar.
 *
 * Auth: sesión admin o Bearer CRON_SECRET.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cronOk = Boolean(process.env.CRON_SECRET) && bearer === process.env.CRON_SECRET;
  if (!cronOk) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session?.user || (role !== "admin" && role !== "superadmin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { id } = await params;
  const sb = supabaseAdmin();
  const { data: t } = await sb
    .from("teachers")
    .select("id, active, users!inner(id, email, full_name, active)")
    .eq("id", id)
    .maybeSingle();
  if (!t) return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });

  const row = t as { active: boolean; users: { id: string; email: string; full_name: string | null; active: boolean } | Array<{ id: string; email: string; full_name: string | null; active: boolean }> };
  const u = Array.isArray(row.users) ? row.users[0] : row.users;
  if (!row.active || !u.active) {
    return NextResponse.json({ error: "teacher_inactive" }, { status: 400 });
  }

  const rawToken = randomBytes(32).toString("base64url");
  const { error: tokErr } = await sb.from("password_reset_tokens").insert({
    user_id:      u.id,
    token_hash:   createHash("sha256").update(rawToken).digest("hex"),
    expires_at:   new Date(Date.now() + SETPW_TOKEN_DAYS * 24 * 3600_000).toISOString(),
    requested_ip: null,
  });
  if (tokErr) {
    return NextResponse.json({ error: "token_insert_failed", reason: tokErr.message }, { status: 500 });
  }

  const firstName = (u.full_name ?? "").trim().split(/\s+/)[0] || (u.full_name ?? "");
  const res = await sendTeacherOnboardingFunnelEmail(u.email, {
    name:           firstName,
    email:          u.email,
    setPasswordUrl: `${PLATFORM_URL}/reset-password?token=${rawToken}`,
    validDays:      SETPW_TOKEN_DAYS,
    platformUrl:    PLATFORM_URL,
  });
  if (!res.ok) {
    return NextResponse.json({ error: "send_failed", reason: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: u.email, emailId: res.id ?? null });
}
