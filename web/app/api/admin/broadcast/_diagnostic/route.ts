import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/admin/broadcast/_diagnostic
 *
 * Admin-only. Returns whether the email env is actually usable in this
 * Vercel deployment. Lets Gelfis confirm at a glance whether Resend is
 * wired up, without having to trawl logs.
 *
 * NEVER returns the API key itself — only whether it's present.
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

  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  const resendKeyPrefix = process.env.RESEND_API_KEY?.slice(0, 4) ?? null;  // "re_" prefix visible, no more
  const fromAddress = process.env.EMAIL_FROM ?? "(default) Aprender-Aleman.de <info@aprender-aleman.de>";

  return NextResponse.json({
    node_env:     process.env.NODE_ENV,
    vercel_env:   process.env.VERCEL_ENV ?? null,
    email: {
      has_resend_api_key: hasResendKey,
      resend_key_prefix:  resendKeyPrefix,
      from_address:       fromAddress,
      ready_to_send:      hasResendKey,
    },
    notes: hasResendKey
      ? "Email pipeline parece configurado. Los envíos deberían llegar realmente."
      : "FALTA RESEND_API_KEY en Vercel. Los envíos están en modo dev: se loguean a consola y la API devuelve ok:true sin enviar nada real.",
  });
}
