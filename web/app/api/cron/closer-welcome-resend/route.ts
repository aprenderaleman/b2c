import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWelcomeStaffEmail } from "@/lib/email/send";
import { getConfigValue } from "@/lib/config-copys";
import { getAdminSignature } from "@/lib/teacher-agreement";
import { loadCloserAgreementVars, getSignedCloserAgreement, signCloserAgreement, uploadCloserAgreement, signedCloserAgreementPath } from "@/lib/closer-agreement";
import { buildCloserAgreementPdf, CLOSER_AGREEMENT_VERSION } from "@/lib/closer-agreement-pdf";

/**
 * POST /api/cron/closer-welcome-resend — herramienta de operación
 * (Gelfis 2026-11-27, caso Iván): reemite el email de bienvenida
 * COMPLETO al closer activo más reciente que (a) nunca inició sesión
 * (must_change_password) y (b) aún no tiene el acuerdo enviado — guard
 * anti-duplicados. Genera contraseña temporal nueva, firma el acuerdo
 * con la firma guardada del superadmin si no estaba firmado, y envía
 * credenciales + enlace al documento de bienvenida + acuerdo adjunto.
 * Sin parámetros; la contraseña viaja solo en el email.
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

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();

  const { data: closerRow } = await sb
    .from("users")
    .select("id, email, full_name, language_preference, must_change_password, closer_agreement_sent_at")
    .eq("role", "closer").eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const c = closerRow as {
    id: string; email: string; full_name: string | null;
    language_preference: "es" | "de" | null;
    must_change_password: boolean; closer_agreement_sent_at: string | null;
  } | null;
  if (!c) return NextResponse.json({ error: "closer_not_found" }, { status: 404 });
  if (!c.must_change_password) {
    return NextResponse.json({ error: "already_logged_in", message: "El closer ya inició sesión: no se le puede regenerar la contraseña." }, { status: 409 });
  }
  if (c.closer_agreement_sent_at) {
    return NextResponse.json({ error: "already_sent", message: "El acuerdo ya consta como enviado — no se reenvía (guard anti-duplicados)." }, { status: 409 });
  }

  // 1. Acuerdo: firmado existente > firmar con la firma guardada del
  //    superadmin > sin firmar.
  let pdf = await getSignedCloserAgreement(c.id);
  let signed = !!pdf;
  let path = pdf ? signedCloserAgreementPath(c.id) : null;
  if (!pdf) {
    const { data: superadmin } = await sb
      .from("users").select("id").eq("role", "superadmin").eq("active", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const adminId = (superadmin as { id: string } | null)?.id;
    const png = adminId ? await getAdminSignature(adminId) : null;
    if (adminId && png) {
      const r = await signCloserAgreement({ closerUserId: c.id, adminUserId: adminId, signaturePng: png });
      pdf = r.pdf; path = r.path; signed = true;
    } else {
      const vars = await loadCloserAgreementVars(c.id);
      if (!vars) return NextResponse.json({ error: "agreement_vars_failed" }, { status: 500 });
      pdf = await buildCloserAgreementPdf(vars);
      path = await uploadCloserAgreement(c.id, pdf);
    }
  }

  // 2. Contraseña temporal nueva (solo porque nunca inició sesión).
  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  const { error: pwErr } = await sb.from("users")
    .update({ password_hash: hash, must_change_password: true })
    .eq("id", c.id).eq("must_change_password", true);
  if (pwErr) return NextResponse.json({ error: "password_update_failed" }, { status: 500 });

  // 3. Email de bienvenida completo.
  const welcomeDocUrl = await getConfigValue("closer_welcome_doc_url");
  const emailResult = await sendWelcomeStaffEmail(c.email, {
    name: (c.full_name ?? "").split(/\s+/)[0] || c.email,
    email: c.email,
    tempPassword,
    platformUrl: process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de",
    role: "closer",
    language: c.language_preference ?? "es",
    welcomeDocUrl,
    agreementAttached: true,
  }, [{ filename: "Acuerdo_Colaboracion_Closer_Aprender-Aleman.pdf", content: pdf, contentType: "application/pdf" }]);

  if (emailResult.ok) {
    await sb.from("users").update({
      closer_agreement_sent_at: new Date().toISOString(),
      closer_agreement_version: CLOSER_AGREEMENT_VERSION,
      closer_agreement_path: path,
    }).eq("id", c.id);
  }

  return NextResponse.json({ ok: emailResult.ok, agreementSigned: signed, docLinkIncluded: !!welcomeDocUrl });
}
