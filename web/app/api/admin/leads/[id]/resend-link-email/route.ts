import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";
import { renderEnvelope, p, h2, button } from "@/lib/email/templates/base";
import { buildLeadJoinUrl } from "@/lib/trial-token";
import { formatBerlinFull } from "@/lib/time";

/**
 * POST /api/admin/leads/[id]/resend-link-email
 *
 * Manda un email corto al lead con el enlace funcional para unirse a su
 * próxima clase de prueba. Pensado para casos donde el lead recibió un
 * recordatorio con URL bare (bug pre-commit 2705c00) o cuando admin
 * quiere reenviar el enlace por la razón que sea.
 *
 * Sin disculpas ni explicaciones técnicas. Solo: "te dejamos el enlace,
 * te esperamos".
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

  const { id: leadId } = await params;
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, language")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }
  const l = lead as { id: string; name: string | null; email: string | null; language: "es" | "de" | null };
  if (!l.email) {
    return NextResponse.json({ ok: false, error: "no_email" }, { status: 400 });
  }

  // Próxima clase de prueba scheduled del lead.
  const { data: cls } = await sb
    .from("classes")
    .select("id, scheduled_at, short_code, is_trial, status")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ ok: false, error: "no_upcoming_trial" }, { status: 404 });
  }
  const c = cls as { id: string; scheduled_at: string; short_code: string | null };

  const joinUrl   = buildLeadJoinUrl({
    classId:   c.id,
    leadId:    l.id,
    shortCode: c.short_code,
    baseUrl:   PLATFORM_URL,
  });
  const lang      = l.language ?? "es";
  const first     = (l.name ?? "").trim().split(/\s+/)[0] || "";
  const startLong = formatBerlinFull(c.scheduled_at, lang);

  const subject = lang === "de"
    ? "Deine Probestunde Deutsch heute"
    : "Tu clase de prueba de alemán de hoy";

  const bodyHtml = lang === "de"
    ? [
        h2(`Hallo ${first}!`),
        p(`Hier ist der Link, um deiner Probestunde Deutsch beizutreten:`),
        p(`<strong>${startLong}</strong>`),
        button("Zum Unterrichtsraum", joinUrl),
        p(`Der Raum öffnet 15 Minuten vorher. Dein Browser fragt nach Kamera- und Mikrofonzugriff — bitte erlauben.`),
        p(`Wir sehen uns gleich!`),
      ].join("\n")
    : [
        h2(`¡Hola ${first}!`),
        p(`Te dejamos el enlace para unirte a tu clase de prueba de alemán:`),
        p(`<strong>${startLong}</strong>`),
        button("Entrar a la clase", joinUrl),
        p(`El aula se abre 15 minutos antes. Tu navegador te pedirá permiso de cámara y micrófono — pulsa "Permitir".`),
        p(`¡Te esperamos!`),
      ].join("\n");

  const html = renderEnvelope(bodyHtml, "Aprender-Aleman.de · Enlace de la clase de prueba.");
  const text = lang === "de"
    ? `Hallo ${first}!\n\nHier ist der Link zu deiner Probestunde Deutsch:\n${startLong}\n\n${joinUrl}\n\nDer Raum öffnet 15 Minuten vorher. Bitte Kamera- und Mikrofonzugriff erlauben.\n\nWir sehen uns gleich!\n\n— Aprender-Aleman.de`
    : `¡Hola ${first}!\n\nTe dejamos el enlace para unirte a tu clase de prueba de alemán:\n${startLong}\n\n${joinUrl}\n\nEl aula se abre 15 minutos antes. Tu navegador te pedirá permiso de cámara y micrófono — pulsa "Permitir".\n\n¡Te esperamos!\n\n— Aprender-Aleman.de`;

  const res = await sendRaw(l.email, subject, html, text);

  // Timeline
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "system_message_sent",
    author:  "admin",
    content: res.ok
      ? `Email correctivo con enlace de la clase enviado (${joinUrl})`
      : `Email correctivo FALLÓ: ${res.error}`,
    metadata: {
      kind:      "resend_link_email",
      channel:   "email",
      class_id:  c.id,
      join_url:  joinUrl,
      message_id: res.ok ? res.id : null,
      error:     res.ok ? null : res.error,
    },
  });

  return NextResponse.json({
    ok:       res.ok,
    email:    l.email,
    class_id: c.id,
    join_url: joinUrl,
    error:    res.ok ? null : res.error,
  });
}
