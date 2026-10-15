import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTeacherAgreementPdf, AGREEMENT_VERSION } from "@/lib/teacher-agreement-pdf";
import { loadAgreementVars, uploadTeacherAgreement, getSignedTeacherAgreement, signedAgreementPath } from "@/lib/teacher-agreement";
import { sendRaw } from "@/lib/email/send";

/**
 * GET  /api/admin/teachers/[id]/agreement            → PDF del acuerdo: la versión
 *      firmada por la academia si existe; si no, se genera sin firmar.
 *      ?draft=1 fuerza la versión sin firmar (vista previa en el modal de firma);
 *      ?rate=15 usa esa tarifa en la vista previa.
 * POST /api/admin/teachers/[id]/agreement            → lo (re)envía por email al
 *      profe (firmado si existe) y registra agreement_sent_at.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return !!session?.user && (role === "admin" || role === "superadmin");
}

async function resolvePdf(id: string, opts?: { draft?: boolean; rate?: number | null }) {
  const vars = await loadAgreementVars(id, { rateOverride: opts?.rate ?? undefined });
  if (!vars) return null;
  if (!opts?.draft) {
    const signed = await getSignedTeacherAgreement(id);
    if (signed) return { vars, pdf: signed, path: signedAgreementPath(id), signed: true };
  }
  const pdf = await buildTeacherAgreementPdf(vars);
  return { vars, pdf, path: null as string | null, signed: false };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const rateQ = Number(url.searchParams.get("rate"));
  const r = await resolvePdf(id, { draft: url.searchParams.get("draft") === "1", rate: Number.isFinite(rateQ) && rateQ > 0 ? rateQ : null });
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const name = r.vars.name.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_");
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Acuerdo_Colaboracion_${name}${r.signed ? "_firmado" : ""}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await resolvePdf(id);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const path = r.path ?? await uploadTeacherAgreement(id, r.pdf);
  const de = r.vars.language === "de";
  const first = r.vars.name.trim().split(/\s+/)[0] || "";
  const subject = de ? "Deine Kooperationsvereinbarung · Aprender-Aleman.de" : "Tu Acuerdo de Colaboración · Aprender-Aleman.de";
  const text = de
    ? `Hallo ${first}!\n\nIm Anhang findest du deine Kooperationsvereinbarung mit Aprender-Aleman.de als PDF, mit deinen Daten und deinem Honorar${r.signed ? ", bereits von der Akademie unterschrieben" : ""}. Lies sie in Ruhe und sende sie uns unterschrieben per Antwort zurück (digitale Unterschrift oder Foto genügt). Bei Fragen melde dich gern.\n\nDas Team von Aprender-Aleman.de`
    : `¡Hola ${first}!\n\nAdjunto tienes tu Acuerdo de Colaboración con Aprender-Aleman.de en PDF, con tus datos y tu tarifa${r.signed ? ", ya firmado por la academia" : ""}. Léelo con calma y, si estás de acuerdo, respóndenos a este correo con el PDF firmado (vale una firma digital o una foto del documento firmado). Si tienes cualquier duda, escríbenos antes de firmar.\n\nEl equipo de Aprender-Aleman.de`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">${text.split("\n\n").map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
  const res = await sendRaw(r.vars.email, subject, html, text,
    [{ filename: "Acuerdo_Colaboracion_Aprender-Aleman.pdf", content: r.pdf, contentType: "application/pdf" }], { critical: true });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  await supabaseAdmin().from("teachers").update({ agreement_sent_at: new Date().toISOString(), agreement_version: AGREEMENT_VERSION, agreement_path: path }).eq("id", id);
  return NextResponse.json({ ok: true });
}
