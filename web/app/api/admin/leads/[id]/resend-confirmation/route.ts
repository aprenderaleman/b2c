import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/admin/leads/[id]/resend-confirmation
 *
 * Manual recovery hook for leads whose booking went through fine in
 * the funnel (DB row + email landed) but whose WhatsApp confirmation
 * never reached them — typically because Evolution's WhatsApp session
 * was disconnected at the moment book-trial ran (we've seen
 * `http_503: no available server` storms during Baileys reconnects).
 *
 * Builds a slightly-tweaked copy that acknowledges this is a
 * re-send so the lead doesn't get a generic "you just booked!" out
 * of the blue 18 hours later.
 *
 * Looks up the lead's most-future scheduled trial class so the date
 * + teacher name + short-link in the message stay accurate. Refuses
 * if the lead has no upcoming trial.
 */
export const runtime = "nodejs";

const PLATFORM_URL = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();

  // Lead + upcoming trial. We rely on the same join shape book-trial uses.
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, language, whatsapp_normalized, status")
    .eq("id", id)
    .maybeSingle();
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  const l = lead as {
    id: string; name: string | null; language: "es" | "de" | null;
    whatsapp_normalized: string | null; status: string;
  };
  if (!l.whatsapp_normalized) {
    return NextResponse.json({ error: "no_whatsapp_on_file" }, { status: 400 });
  }

  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, short_code,
      teacher:teachers!inner(users!inner(full_name, email))
    `)
    .eq("lead_id", id)
    .eq("is_trial", true)
    .in("status", ["scheduled", "live"])
    .gte("scheduled_at", new Date(Date.now() - 60 * 60_000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ error: "no_upcoming_trial" }, { status: 400 });
  }
  const c = cls as {
    id: string; scheduled_at: string; short_code: string;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
  };
  const teacherWrap = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
  const teacherUser = teacherWrap
    ? (Array.isArray(teacherWrap.users) ? teacherWrap.users[0] : teacherWrap.users)
    : null;
  const teacherName = teacherUser?.full_name?.trim() || teacherUser?.email || "tu profesor/a";

  const lang     = (l.language ?? "es") as "es" | "de";
  const leadFirst = (l.name ?? "").split(/\s+/)[0] || (l.name ?? "");

  const startDate = new Date(c.scheduled_at).toLocaleString(
    lang === "de" ? "de-DE" : "es-ES",
    {
      timeZone: "Europe/Berlin",
      weekday:  "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    },
  ) + (lang === "de" ? " (Berlin)" : " (Berlín)");

  const shortLinkUrl = `${PLATFORM_URL.replace(/\/$/, "")}/c/${c.short_code}`;

  const text = lang === "de"
    ? (
        `Hallo ${leadFirst}! 👋\n\n` +
        `Hier nochmal die Bestätigung deiner kostenlosen Probestunde Deutsch — falls du sie zuvor nicht erhalten hast.\n\n` +
        `📅 ${startDate}\n` +
        `👤 ${teacherName} · 45 Min\n` +
        `🔗 ${shortLinkUrl}\n\n` +
        `💡 Beim Klick auf den Link fragt dein Browser nach Mikrofon- und Kamerazugriff — bitte auf "Erlauben" klicken.\n\n` +
        `Bestätige mir bitte mit einem "Ja", dass du dabei bist. 🙌\n\n` +
        `— Aprender-Aleman.de`
      )
    : (
        `¡Hola ${leadFirst}! 👋\n\n` +
        `Te reenvío la confirmación de tu clase de prueba GRATUITA de alemán — por si no te llegó antes.\n\n` +
        `📅 ${startDate}\n` +
        `👤 ${teacherName} · 45 min\n` +
        `🔗 ${shortLinkUrl}\n\n` +
        `💡 Importante: al abrir el enlace, tu navegador te pedirá permiso para usar micrófono y cámara — pulsa "Permitir".\n\n` +
        `¿Me confirmas con un "Sí" que asistirás? 🙌\n\n` +
        `— Aprender-Aleman.de`
      );

  const result = await sendWhatsappText(l.whatsapp_normalized, text);

  if (result.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: id,
      type:    "system_message_sent",
      author:  "gelfis",
      content: `💬 WhatsApp de confirmación REENVIADO manualmente a ${l.whatsapp_normalized}`,
      metadata: { channel: "whatsapp", kind: "trial_confirmation_resend", class_id: c.id },
    });
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } else {
    await sb.from("lead_timeline").insert({
      lead_id: id,
      type:    "send_failed",
      author:  "gelfis",
      content: `💬 Falló el reenvío manual del WhatsApp: ${result.reason}`,
      metadata: { channel: "whatsapp", kind: "trial_confirmation_resend", error: result.reason },
    });
    return NextResponse.json({ error: "send_failed", reason: result.reason }, { status: 502 });
  }
}
