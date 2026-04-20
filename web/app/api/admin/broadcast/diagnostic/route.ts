import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { emailBackendConfigured } from "@/lib/email/client";

/**
 * GET /api/admin/broadcast/diagnostic
 *
 * Admin-only. Reports whether the email pipeline is actually usable in
 * this deployment — checks both Resend (RESEND_API_KEY) and SMTP
 * (SMTP_HOST + SMTP_USER + SMTP_PASS). NEVER leaks secrets; only
 * presence flags + safe prefixes.
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

  const backend   = emailBackendConfigured();
  const hasResend = Boolean(process.env.RESEND_API_KEY);
  const hasSmtp   = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const fromAddr  = process.env.EMAIL_FROM ?? "(default) Aprender-Aleman.de <info@aprender-aleman.de>";

  return NextResponse.json({
    node_env:       process.env.NODE_ENV,
    vercel_env:     process.env.VERCEL_ENV ?? null,
    active_backend: backend,                       // "resend" | "smtp" | null
    email: {
      from_address:  fromAddr,
      ready_to_send: backend !== null,
      resend: {
        has_api_key: hasResend,
        key_prefix:  process.env.RESEND_API_KEY?.slice(0, 4) ?? null,
      },
      smtp: {
        configured: hasSmtp,
        host:       process.env.SMTP_HOST ?? null,
        port:       Number(process.env.SMTP_PORT ?? 465),
        user:       process.env.SMTP_USER ?? null,
        secure:     process.env.SMTP_SECURE ?? "(auto: true si puerto=465, si no false)",
      },
    },
    notes: backend === "resend"
      ? "Usando Resend — envíos reales vía API."
      : backend === "smtp"
        ? "Usando SMTP (nodemailer) — envíos reales vía tu servidor SMTP."
        : "FALTA configuración. Ni RESEND_API_KEY ni (SMTP_HOST + SMTP_USER + SMTP_PASS) están definidas. Los envíos se loguean a consola en vez de mandarse.",
  });
}
