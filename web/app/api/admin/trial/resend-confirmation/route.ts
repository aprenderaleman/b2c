import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { buildLeadJoinUrl } from "@/lib/trial-token";
import { buildTrialIcs } from "@/lib/ics";

/**
 * GET /api/admin/trial/resend-confirmation?secret=X&classId=UUID
 *
 * Reenvía el email de confirmación de una clase de prueba (incluye
 * enlace del aula virtual + .ics). SOLO email — no re-dispara WA.
 *
 * Útil cuando el email original salió a un address con typo y hubo que
 * corregirlo manualmente (Gelfis 2026-11-16, caso Mayra).
 *
 * Auth: query ?secret o header X-Cron-Secret = CRON_SECRET.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.CRON_SECRET;
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const classId = url.searchParams.get("classId") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(classId)) {
    return NextResponse.json({ error: "invalid_classId" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, short_code, deposit_paid_at,
      lead:leads!inner(id, name, email, language, reserva_prioritaria),
      teacher:teachers!classes_teacher_id_fkey!inner(users!inner(full_name, email))
    `)
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;
  const c = cls as unknown as {
    id: string; scheduled_at: string; duration_minutes: number | null;
    short_code: string | null; deposit_paid_at: string | null;
    lead: unknown; teacher: unknown;
  };
  const lead = flat(c.lead) as { id: string; name: string | null; email: string | null; language: "es"|"de"|null; reserva_prioritaria: boolean | null } | null;
  if (!lead?.email) return NextResponse.json({ error: "no_email_on_lead" }, { status: 400 });

  const teacherWrap = flat(c.teacher) as { users: unknown } | null;
  const teacherUser = teacherWrap ? flat(teacherWrap.users) as { full_name: string | null; email: string } | null : null;
  const teacherName = teacherUser?.full_name ?? teacherUser?.email ?? "tu profesor/a";

  const language: "es" | "de" = lead.language === "de" ? "de" : "es";
  const leadFirst = (lead.name ?? "").trim().split(/\s+/)[0] || (lead.name ?? "");
  const durationMin = c.duration_minutes ?? 40;
  const paid = !!c.deposit_paid_at || lead.reserva_prioritaria === true;

  const startDate = new Date(c.scheduled_at).toLocaleString(language === "de" ? "de-DE" : "es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  }) + (language === "de" ? " (Berlin)" : " (Berlín)");

  const joinUrl = buildLeadJoinUrl({
    classId: c.id, leadId: lead.id, shortCode: c.short_code, baseUrl: PLATFORM_URL,
  });
  const classTitle = `${leadFirst || "Estudiante"} + Sesión de Prueba de Alemán ☀️`;
  const icsContent = buildTrialIcs({
    uid: c.id, startIso: c.scheduled_at, durationMin, summary: classTitle,
    description: `Aula virtual: ${joinUrl}`,
    organizerName: "Aprender-Aleman.de", organizerEmail: "aprenderaleman2026@gmail.com",
    attendeeName: lead.name ?? "", attendeeEmail: lead.email,
    location: joinUrl,
  });

  const STRIPE_DEPOSIT_URL = process.env.NEXT_PUBLIC_STRIPE_DEPOSIT_URL
    ?? "https://buy.stripe.com/bJe6oAcXzd9W2xFedx0co0n?locale=es";

  const res = await sendTrialConfirmationEmail(lead.email, {
    leadName: leadFirst || "amigo",
    classTitle,
    startDate,
    durationMin,
    teacherName,
    joinUrl,
    confirmUrl: buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "confirm" }),
    rescheduleUrl: buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "reschedule" }),
    language,
    depositPaid: paid,
    depositUrl: paid ? null : STRIPE_DEPOSIT_URL,
  }, { content: icsContent, filename: "clase-de-prueba-aleman.ics" });

  // Timeline del reenvío
  await sb.from("lead_timeline").insert({
    lead_id: lead.id,
    type: res.ok ? "system_message_sent" : "send_failed",
    author: "gelfis",
    content: res.ok
      ? `✉️ Reenvío manual de email confirmación (con enlace aula) a ${lead.email}`
      : `✉️ Falló reenvío email confirmación: ${"error" in res ? res.error : "unknown"}`,
    metadata: { kind: "trial_confirmation_resend", channel: "email", class_id: c.id, actor: "gelfis" },
  });

  return NextResponse.json({
    ok: res.ok,
    sent_to: lead.email,
    class_id: c.id,
    start_date: startDate,
    join_url: joinUrl,
    teacher_name: teacherName,
  });
}
