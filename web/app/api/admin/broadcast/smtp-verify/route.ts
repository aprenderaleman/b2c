import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSmtp } from "@/lib/email/client";

/**
 * GET /api/admin/broadcast/smtp-verify
 *
 * Opens an SMTP connection + runs the AUTH handshake WITHOUT sending
 * any email. Returns the exact error if it fails, so "why isn't the
 * email going out?" becomes a single-step diagnosis.
 *
 * Admin-only. Never echoes the password.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const smtp = getSmtp();
  if (!smtp) {
    return NextResponse.json({
      ok:    false,
      stage: "config",
      error: "SMTP no configurado. Faltan SMTP_HOST / SMTP_USER / SMTP_PASS en env vars.",
    });
  }

  const envSummary = {
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 465),
    user:   process.env.SMTP_USER,
    secure: process.env.SMTP_SECURE ?? "(auto)",
  };

  try {
    await smtp.verify();
    return NextResponse.json({
      ok:      true,
      stage:   "connected+authenticated",
      env:     envSummary,
      note:    "Conexión TLS + autenticación OK. Puedes enviar emails ya.",
    });
  } catch (e) {
    const err = e as Error & { code?: string; responseCode?: number; command?: string };
    return NextResponse.json({
      ok:      false,
      stage:   "verify",
      env:     envSummary,
      error:   err.message,
      code:    err.code ?? null,
      response_code: err.responseCode ?? null,
      command: err.command ?? null,
    });
  }
}
