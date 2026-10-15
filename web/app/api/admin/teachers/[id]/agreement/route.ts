import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTeacherAgreementPdf, AGREEMENT_VERSION } from "@/lib/teacher-agreement-pdf";
import { uploadTeacherAgreement } from "@/lib/teacher-agreement";
import { sendRaw } from "@/lib/email/send";

/**
 * GET  /api/admin/teachers/[id]/agreement  → PDF del Acuerdo de Colaboración
 *      (regenerado con los datos actuales del profe; fecha de inicio =
 *      approved_at o created_at).
 * POST /api/admin/teachers/[id]/agreement  → lo (re)envía por email al profe
 *      y registra agreement_sent_at. Para profes ya activos que no lo
 *      recibieron al aprobarse.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadTeacher(id: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("teachers")
    .select("id, hourly_rate_individual, country, approved_at, created_at, users!inner(email, full_name, phone, language_preference)")
    .eq("id", id).maybeSingle();
  if (!data) return null;
  const t = data as { id: string; hourly_rate_individual: number | string | null; country: string | null; approved_at: string | null; created_at: string; users: unknown };
  const u = (Array.isArray(t.users) ? t.users[0] : t.users) as { email: string; full_name: string | null; phone: string | null; language_preference: "es" | "de" | null };
  const rate = t.hourly_rate_individual != null && Number(t.hourly_rate_individual) > 0 ? Number(t.hourly_rate_individual) : null;
  const pdf = await buildTeacherAgreementPdf({
    name: u.full_name ?? u.email, email: u.email, phone: u.phone ?? null, country: t.country ?? null,
    startDate: new Date(t.approved_at ?? t.created_at), rateEur: rate,
  });
  return { t, u, pdf };
}

async function guard() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return !!session?.user && (role === "admin" || role === "superadmin");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await loadTeacher(id);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const name = (r.u.full_name ?? "profesor").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "_");
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Acuerdo_Colaboracion_${name}.pdf"` },
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await loadTeacher(id);
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const path = await uploadTeacherAgreement(r.t.id, r.pdf);
  const de = r.u.language_preference === "de";
  const first = (r.u.full_name ?? "").trim().split(/\s+/)[0] || "";
  const subject = de ? "Deine Kooperationsvereinbarung · Aprender-Aleman.de" : "Tu Acuerdo de Colaboración · Aprender-Aleman.de";
  const text = de
    ? `Hallo ${first}!\n\nIm Anhang findest du deine Kooperationsvereinbarung mit Aprender-Aleman.de als PDF, mit deinen Daten und deinem Honorar. Lies sie in Ruhe und sende sie uns unterschrieben per Antwort zurück (digitale Unterschrift oder Foto genügt). Bei Fragen melde dich gern.\n\nDas Team von Aprender-Aleman.de`
    : `¡Hola ${first}!\n\nAdjunto tienes tu Acuerdo de Colaboración con Aprender-Aleman.de en PDF, con tus datos y tu tarifa. Léelo con calma y, si estás de acuerdo, respóndenos a este correo con el PDF firmado (vale una firma digital o una foto del documento firmado). Si tienes cualquier duda, escríbenos antes de firmar.\n\nEl equipo de Aprender-Aleman.de`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">${text.split("\n\n").map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
  const res = await sendRaw(r.u.email, subject, html, text,
    [{ filename: "Acuerdo_Colaboracion_Aprender-Aleman.pdf", content: r.pdf, contentType: "application/pdf" }], { critical: true });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  await supabaseAdmin().from("teachers").update({ agreement_sent_at: new Date().toISOString(), agreement_version: AGREEMENT_VERSION, agreement_path: path }).eq("id", id);
  return NextResponse.json({ ok: true });
}
