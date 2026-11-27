import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { renderWelcomeStaff } from "@/lib/email/templates/welcome-staff";
import { sendRaw } from "@/lib/email/send";
import { getConfigValue } from "@/lib/config-copys";
import { loadCloserAgreementVars, getSignedCloserAgreement } from "@/lib/closer-agreement";
import { buildCloserAgreementPdf } from "@/lib/closer-agreement-pdf";

/**
 * POST /api/cron/closer-welcome-preview — herramienta de operación
 * (Gelfis 2026-11-27): envía AL SUPERADMIN una muestra del email de
 * bienvenida que recibe un closer nuevo (credenciales de ejemplo, enlace
 * al documento de bienvenida y el Acuerdo de Colaboración adjunto, con
 * los datos del closer más reciente). La clave de Resend solo existe en
 * Vercel, por eso no se puede enviar desde local. Destinatario fijo: el
 * email del superadmin — sin parámetros.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();

  const { data: superadmin } = await sb
    .from("users").select("email").eq("role", "superadmin").eq("active", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const to = (superadmin as { email: string } | null)?.email;
  if (!to) return NextResponse.json({ error: "superadmin_not_found" }, { status: 404 });

  const { data: closer } = await sb
    .from("users").select("id, email, full_name").eq("role", "closer").eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const c = closer as { id: string; email: string; full_name: string | null } | null;
  if (!c) return NextResponse.json({ error: "closer_not_found" }, { status: 404 });

  const [welcomeDocUrl, vars, signed] = await Promise.all([
    getConfigValue("closer_welcome_doc_url"),
    loadCloserAgreementVars(c.id),
    getSignedCloserAgreement(c.id),
  ]);
  if (!vars) return NextResponse.json({ error: "agreement_vars_failed" }, { status: 500 });
  const pdf = signed ?? await buildCloserAgreementPdf(vars);

  const { subject, html, text } = renderWelcomeStaff({
    name: (c.full_name ?? "").split(/\s+/)[0] || c.email,
    email: c.email,
    tempPassword: "Ejemplo-NoReal-1234",
    platformUrl: process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de",
    role: "closer",
    language: "es",
    welcomeDocUrl,
    agreementAttached: true,
  });

  const res = await sendRaw(to, `[MUESTRA] ${subject}`, html, text,
    [{ filename: "Acuerdo_Colaboracion_Closer_Aprender-Aleman.pdf", content: pdf, contentType: "application/pdf" }],
    { critical: true });

  return NextResponse.json({ ok: res.ok, agreementSigned: !!signed, ...(res.ok ? {} : { error: "send_failed" }) });
}
