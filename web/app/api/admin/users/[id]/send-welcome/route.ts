import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { issuePasswordResetToken } from "@/lib/password-reset";
import { sendWelcomePlatformEmail } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * POST /api/admin/users/[id]/send-welcome
 *
 * Disparado por un admin desde /admin/usuarios cuando un alumno aún no
 * ha entrado a la plataforma (last_login_at IS NULL típico). Envía un
 * email de bienvenida con:
 *   - El email registrado del usuario (para que sepa cuál usar)
 *   - Botón directo "Establecer contraseña" con token de reset (1h)
 *   - Tour rápido del dashboard
 *
 * Idempotente — se puede disparar varias veces (cada llamada genera un
 * nuevo token y manda un nuevo email). Útil cuando el alumno reporta
 * "no recibí el correo" o "el link expiró".
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();

  // Fetch the target user.
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, email, full_name, language_preference, active")
    .eq("id", id)
    .maybeSingle();
  if (userErr || !user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const u = user as {
    id: string; email: string; full_name: string | null;
    language_preference: "es" | "de"; active: boolean;
  };
  if (!u.active) {
    return NextResponse.json({ error: "user_inactive" }, { status: 400 });
  }

  // Generate the reset token (uses the same flow as /forgot-password).
  let resetUrl: string | null = null;
  let expiresInHours = 1;
  try {
    const issued = await issuePasswordResetToken(u.email, PLATFORM_URL, null);
    resetUrl       = issued.resetUrl;
    expiresInHours = issued.expiresInHours;
  } catch (e) {
    console.error("[send-welcome] issue token failed:", e);
    return NextResponse.json({ error: "token_failed" }, { status: 500 });
  }

  if (!resetUrl) {
    // Should be impossible if the user is active — but just in case.
    return NextResponse.json({ error: "no_reset_url" }, { status: 500 });
  }

  // Send the welcome email.
  const sendResult = await sendWelcomePlatformEmail(u.email, {
    name:           u.full_name,
    loginEmail:     u.email,
    setPasswordUrl: resetUrl,
    expiresInHours,
    platformUrl:    PLATFORM_URL,
    language:       u.language_preference,
  });

  if (!sendResult.ok) {
    return NextResponse.json(
      { error: "send_failed", message: sendResult.error },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sentTo: u.email });
}
