import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";
import { renderEnvelope, p, h2, button } from "@/lib/email/templates/base";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * POST /api/admin/leads/[id]/send-trial-reminder-email
 *
 * Recordatorio EXTRA por email a un lead con clase de prueba próxima.
 * Pensado para usar manualmente durante un ban de WhatsApp (Gelfis
 * 2026-06-24). Auth: CRON_SECRET.
 *
 * Toma la próxima clase de prueba del lead y arma un email con:
 *   - Fecha + hora
 *   - Botón "Entrar al aula" con magic-link
 *   - Instrucciones para unirse
 *   - Firma Stiv (sin mención a WhatsApp)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: leadId } = await params;
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, language")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  const l = lead as { id: string; name: string | null; email: string | null; language: "es"|"de"|null };
  if (!l.email) return NextResponse.json({ error: "no_email" }, { status: 400 });

  // Trial más próximo
  const { data: cls } = await sb
    .from("classes")
    .select("id, scheduled_at, short_code")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "no_upcoming_trial" }, { status: 400 });
  const c = cls as { id: string; scheduled_at: string; short_code: string };

  const lang = (l.language ?? "es") as "es" | "de";
  const firstName = (l.name ?? "").trim().split(/\s+/)[0] || (l.name ?? "");
  const startDate = new Date(c.scheduled_at).toLocaleString(
    lang === "de" ? "de-DE" : "es-ES",
    { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" },
  ) + (lang === "de" ? " (Berlin)" : " (Berlín)");
  const joinUrl = buildLeadJoinUrl({ classId: c.id, leadId: l.id, shortCode: c.short_code, baseUrl: PLATFORM_URL });

  const subject = lang === "de"
    ? `🔔 Erinnerung: deine Probestunde — ${startDate}`
    : `🔔 Recordatorio: tu clase de prueba — ${startDate}`;

  const body = lang === "de"
    ? `
        ${h2(`Hallo ${firstName}! 👋`)}
        ${p(`Eine kurze Erinnerung an deine <strong>Deutsch-Probestunde</strong>:`)}
        ${p(`📅 <strong>${startDate}</strong><br>⏱ 45 Minuten`)}
        <div style="text-align:center;margin:24px 0 8px 0;">${button(joinUrl, "Zum Klassenzimmer →")}</div>
        ${p(`<em style="color:#64748b;">5 Minuten vorher den Link öffnen. Du brauchst nichts zu installieren — das Klassenzimmer öffnet sich im Browser.</em>`)}
        ${p(`Stell vorher sicher:<br>• Stabile Internetverbindung<br>• Kamera und Mikrofon<br>• Ein ruhiger Ort`)}
        ${p(`Bis gleich!`)}
        ${p(`<em style="color:#64748b;">— Stiv</em>`)}
      `
    : `
        ${h2(`¡Hola ${firstName}! 👋`)}
        ${p(`Solo un recordatorio rápido de tu <strong>clase de prueba de alemán</strong>:`)}
        ${p(`📅 <strong>${startDate}</strong><br>⏱ 45 minutos`)}
        <div style="text-align:center;margin:24px 0 8px 0;">${button(joinUrl, "Entrar al aula →")}</div>
        ${p(`<em style="color:#64748b;">Abre el enlace 5 minutos antes de la clase. No necesitas instalar nada — el aula se abre en el navegador.</em>`)}
        ${p(`Antes de empezar asegúrate de tener:<br>• Buena conexión a internet<br>• Cámara y micrófono<br>• Un sitio tranquilo</em>`)}
        ${p(`¡Nos vemos!`)}
        ${p(`<em style="color:#64748b;">— Stiv</em>`)}
      `;

  const text = lang === "de"
    ? [
        `Hallo ${firstName}!`, ``,
        `Erinnerung an deine Deutsch-Probestunde:`,
        `📅 ${startDate}`, `⏱ 45 Min`, ``,
        `Zum Klassenzimmer: ${joinUrl}`, ``,
        `5 Minuten vorher öffnen. Kamera + Mikrofon + ruhiger Ort.`, ``,
        `— Stiv`,
      ].join("\n")
    : [
        `¡Hola ${firstName}!`, ``,
        `Recordatorio de tu clase de prueba:`,
        `📅 ${startDate}`, `⏱ 45 min`, ``,
        `Entrar al aula: ${joinUrl}`, ``,
        `Abre el enlace 5 min antes. Cámara + micrófono + lugar tranquilo.`, ``,
        `— Stiv`,
      ].join("\n");

  const footerNote = lang === "de"
    ? "Du erhältst diese E-Mail, weil du eine Probestunde bei uns gebucht hast."
    : "Recibes este correo porque tienes una clase de prueba agendada con nosotros.";

  const res = await sendRaw(l.email, subject, renderEnvelope(body, footerNote), text);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  await sb.from("lead_timeline").insert({
    lead_id: l.id,
    type: "system_message_sent",
    author: "system",
    content: `[Email recordatorio extra] ${subject}`,
    metadata: { kind: "trial_reminder_extra", channel: "email", class_id: c.id, sent_to: l.email },
  });
  return NextResponse.json({ ok: true, sent_to: l.email });
}
