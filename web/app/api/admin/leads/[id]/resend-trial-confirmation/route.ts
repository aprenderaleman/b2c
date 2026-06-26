import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { buildLeadJoinUrl } from "@/lib/trial-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/leads/[id]/resend-trial-confirmation?to=foo@bar.com&update_email=1
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 *
 * Re-envía el email de confirmación de clase de prueba al `to` indicado
 * (o al email del lead si no se pasa). Útil cuando el lead pide enviar
 * a un email distinto al que dejó (caso típico: alias, email de su
 * pareja/padre, etc.).
 *
 * Si `update_email=1`, sobreescribe `leads.email` con el nuevo `to`
 * para que TODOS los próximos crones (T-2h, T-15min, morning, etc.)
 * usen también el nuevo destino.
 */
function authd(req: Request): boolean {
  const e = process.env.CRON_SECRET;
  if (!e) return false;
  const b = req.headers.get("authorization");
  if (b && b.toLowerCase().startsWith("bearer ") && b.slice(7).trim() === e) return true;
  return req.headers.get("x-cron-secret") === e;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authd(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: leadId } = await ctx.params;
  const url = new URL(req.url);
  const toOverride  = url.searchParams.get("to")?.trim().toLowerCase() || null;
  const updateEmail = url.searchParams.get("update_email") === "1";

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, language")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, short_code,
      teacher:teachers!inner(users!inner(full_name, email))
    `)
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "no_trial_class" }, { status: 404 });

  type LeadRow = { id: string; name: string | null; email: string | null; language: string | null };
  type ClassRow = {
    id: string; scheduled_at: string; duration_minutes: number | null; short_code: string | null;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const l = lead as LeadRow;
  const c = cls as ClassRow;
  const teacherWrap = flat(c.teacher);
  const tu = teacherWrap ? flat(teacherWrap.users) : null;
  const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";

  const recipient = toOverride ?? l.email;
  if (!recipient) return NextResponse.json({ error: "no_recipient" }, { status: 400 });

  const leadFirst = (l.name ?? "").trim().split(/\s+/)[0] || "amigo";
  const lang: "es" | "de" = l.language === "de" ? "de" : "es";
  const durationMin = c.duration_minutes ?? 30;

  const startDate = new Date(c.scheduled_at).toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  });

  const joinUrl = buildLeadJoinUrl({
    classId:   c.id,
    leadId:    l.id,
    shortCode: c.short_code,
  });
  const confirmUrl    = buildEmailActionUrl({ leadId: l.id, classId: c.id, action: "confirm" });
  const rescheduleUrl = buildEmailActionUrl({ leadId: l.id, classId: c.id, action: "reschedule" });

  const result = await sendTrialConfirmationEmail(recipient, {
    leadName: leadFirst,
    classTitle: "Clase de prueba",
    startDate: `${startDate} (Berlín)`,
    durationMin,
    teacherName,
    joinUrl,
    confirmUrl,
    rescheduleUrl,
    language: lang,
  });

  let emailUpdated = false;
  if (updateEmail && toOverride) {
    const { error: upErr } = await sb
      .from("leads")
      .update({ email: toOverride, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    emailUpdated = !upErr;
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "agent_note",
      author:  "system",
      content: `📧 Email del lead actualizado a ${toOverride} (re-envío manual de trial-confirmation)`,
      metadata: { kind: "email_updated_manual", new_email: toOverride, class_id: c.id },
    });
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "system_message_sent",
    author:  "system",
    content: `[Email re-enviado: Confirmación clase de prueba ${startDate}]\n\nEnviado a ${recipient}`,
    metadata: { kind: "trial_confirmation_resent", recipient, class_id: c.id, result },
  });

  return NextResponse.json({ ok: true, recipient, emailUpdated, result });
}
