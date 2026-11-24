import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { renderTrialReconfirmAsk, renderTrialReconfirmReleased } from "@/lib/email/templates/trial-reconfirm";
import { notifyTeacherClassChanged } from "@/lib/assignee-notifications";
import { removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";

/**
 * GET/POST /api/cron/trial-reconfirm — cada hora.
 *
 * Reconfirmación de clases de prueba reservadas con mucha antelación
 * (Gelfis 2026-11-24, "opción A"). Datos jul–nov 2026: quien reserva
 * con ≥8 días de antelación convierte al 2 % (vs 7–10 % con 1–7 días).
 *
 * Aplica a trials `scheduled` cuya antelación de reserva
 * (scheduled_at − created_at) supera LONG_LEAD_DAYS y que el lead NO ha
 * confirmado (classes.student_confirmed_at o leads.trial_confirmed_at
 * posterior a la reserva):
 *
 *   1. ASK  — ~48 h antes: email "¿sigues contando con tu clase?" con
 *             botón de confirmar. Marca ASK_TAG en notes_admin.
 *   2. FREE — a RELEASE_HOURS_BEFORE de la clase, si sigue sin confirmar:
 *             cancela la clase (libera el hueco para el embudo), borra
 *             los eventos de calendario, avisa al profe (helper estándar)
 *             y manda al lead el email "hemos liberado tu plaza" con
 *             enlace para reservar otra. Sin WhatsApp (email-first).
 *
 * Solo libera clases a las que se les pidió reconfirmación (ASK_TAG):
 * nunca cancela una clase sin aviso previo.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LONG_LEAD_DAYS       = 7;
const ASK_FROM_HOURS       = 42;   // se pide entre 42 y 50 h antes
const ASK_TO_HOURS         = 50;
const RELEASE_HOURS_BEFORE = 18;   // plazo para confirmar
const ASK_TAG     = "[trial_reconfirm_asked]";
const RELEASE_TAG = "[trial_reconfirm_released]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorised(req: Request): boolean {
  const e = process.env.CRON_SECRET;
  if (!e) return false;
  const b = req.headers.get("authorization");
  if (b && b.toLowerCase().startsWith("bearer ") && b.slice(7).trim() === e) return true;
  return req.headers.get("x-cron-secret") === e;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

type LeadRow = {
  id: string; name: string | null; email: string | null; status: string | null;
  trial_confirmed_at: string | null; ai_paused_until: string | null;
  reschedule_state: { phase?: string } | null;
};
type ClassRow = {
  id: string; scheduled_at: string; created_at: string; notes_admin: string | null;
  student_confirmed_at: string | null; lead_id: string | null;
  lead: LeadRow | LeadRow[] | null;
};
const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

function berlin(iso: string | number): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  }) + " (Berlín)";
}

function isLongLead(c: ClassRow): boolean {
  return Date.parse(c.scheduled_at) - Date.parse(c.created_at) > LONG_LEAD_DAYS * 86_400_000;
}

function isConfirmed(c: ClassRow, lead: LeadRow): boolean {
  if (c.student_confirmed_at) return true;
  // trial_confirmed_at vive en el lead: solo cuenta si es posterior a
  // esta reserva (un lead con trials previos puede arrastrar uno viejo).
  return !!lead.trial_confirmed_at && Date.parse(lead.trial_confirmed_at) >= Date.parse(c.created_at);
}

async function run(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  const sb = supabaseAdmin();
  const now = Date.now();
  const select = `
    id, scheduled_at, created_at, notes_admin, student_confirmed_at, lead_id,
    lead:leads!inner(id, name, email, status, trial_confirmed_at, ai_paused_until, reschedule_state)
  `;

  const result = { asked: [] as string[], released: [] as string[], skipped: 0, dryRun };

  // ── 1. ASK ─────────────────────────────────────────────────────────
  const { data: toAsk } = await sb.from("classes").select(select)
    .eq("is_trial", true).eq("status", "scheduled")
    .gte("scheduled_at", new Date(now + ASK_FROM_HOURS * 3600_000).toISOString())
    .lte("scheduled_at", new Date(now + ASK_TO_HOURS * 3600_000).toISOString());

  for (const c of (toAsk ?? []) as ClassRow[]) {
    const lead = flat(c.lead);
    if (!lead || !lead.email) { result.skipped++; continue; }
    if ((c.notes_admin ?? "").includes(ASK_TAG)) continue;
    if (!isLongLead(c) || isConfirmed(c, lead)) continue;
    if (lead.status === "converted") { result.skipped++; continue; }
    if (lead.reschedule_state?.phase?.startsWith("AWAITING_")) { result.skipped++; continue; }
    if (lead.ai_paused_until && Date.parse(lead.ai_paused_until) > now) { result.skipped++; continue; }

    const first = (lead.name ?? "").trim().split(/\s+/)[0] || "hola";
    if (dryRun) { result.asked.push(`${first} · ${berlin(c.scheduled_at)}`); continue; }

    // Lock idempotente: marcamos antes de enviar.
    const { data: locked } = await sb.from("classes")
      .update({ notes_admin: `${c.notes_admin ?? ""}\n${ASK_TAG} ${new Date().toISOString()}`.trim() })
      .eq("id", c.id).eq("status", "scheduled")
      .not("notes_admin", "ilike", `%${ASK_TAG}%`)
      .select("id").maybeSingle();
    // notes_admin NULL no pasa el filtro "not ilike" → reintento sin él.
    let ok = !!locked;
    if (!ok && c.notes_admin == null) {
      const { data: l2 } = await sb.from("classes")
        .update({ notes_admin: `${ASK_TAG} ${new Date().toISOString()}` })
        .eq("id", c.id).is("notes_admin", null).select("id").maybeSingle();
      ok = !!l2;
    }
    if (!ok) continue;

    const { subject, html, text } = renderTrialReconfirmAsk({
      leadName:      first,
      startDate:     berlin(c.scheduled_at),
      deadline:      berlin(Date.parse(c.scheduled_at) - RELEASE_HOURS_BEFORE * 3600_000),
      confirmUrl:    buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "confirm" }),
      rescheduleUrl: buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "reschedule" }),
    });
    const r = await sendRaw(lead.email, subject, html, text);
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    r.ok ? "system_message_sent" : "send_failed",
      author:  "system",
      content: r.ok
        ? `📧 Reconfirmación pedida (reservó con >${LONG_LEAD_DAYS} días de antelación). Si no confirma antes de ${RELEASE_HOURS_BEFORE} h de la clase, se libera la plaza.`
        : `📧 Falló el email de reconfirmación: ${r.error}`,
      metadata: { channel: "email", kind: "trial_reconfirm_ask", class_id: c.id, sent_to: lead.email },
    });
    if (r.ok) result.asked.push(c.id);
  }

  // ── 2. FREE ────────────────────────────────────────────────────────
  const { data: toFree } = await sb.from("classes").select(select)
    .eq("is_trial", true).eq("status", "scheduled")
    .ilike("notes_admin", `%${ASK_TAG}%`)
    .gt("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", new Date(now + RELEASE_HOURS_BEFORE * 3600_000).toISOString());

  for (const c of (toFree ?? []) as ClassRow[]) {
    const lead = flat(c.lead);
    if (!lead) continue;
    if ((c.notes_admin ?? "").includes(RELEASE_TAG)) continue;
    if (isConfirmed(c, lead) || lead.status === "converted") continue;
    if (lead.ai_paused_until && Date.parse(lead.ai_paused_until) > now) { result.skipped++; continue; }

    const first = (lead.name ?? "").trim().split(/\s+/)[0] || "hola";
    if (dryRun) { result.released.push(`${first} · ${berlin(c.scheduled_at)}`); continue; }

    const { data: cancelled } = await sb.from("classes")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
        notes_admin: `${c.notes_admin ?? ""}\n${RELEASE_TAG} ${new Date().toISOString()}`.trim(),
      })
      .eq("id", c.id).eq("status", "scheduled")
      .select("id").maybeSingle();
    if (!cancelled) continue;

    await removeTeacherCalendarEvents([c.id]).catch(e => console.error("[trial-reconfirm] gcal cleanup failed:", e));
    await notifyTeacherClassChanged({
      classId: c.id, kind: "cancelled", previousDate: c.scheduled_at,
      actorUserId: null, actorLabel: "sistema (el alumno no confirmó)",
    });

    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "status_change",
      author:  "system",
      content: `🚫 Clase de prueba liberada (${berlin(c.scheduled_at)}): no confirmó la reconfirmación.`,
      metadata: { class_id: c.id, kind: "trial_reconfirm_released" },
    });

    if (lead.email) {
      const { subject, html, text } = renderTrialReconfirmReleased({
        leadName:  first,
        startDate: berlin(c.scheduled_at),
        bookUrl:   `${PLATFORM_URL}/agendar/cuando?lead=${lead.id}&from=trial_released`,
      });
      const r = await sendRaw(lead.email, subject, html, text);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    r.ok ? "system_message_sent" : "send_failed",
        author:  "system",
        content: r.ok ? `📧 Aviso de plaza liberada enviado a ${lead.email}` : `📧 Falló el aviso de plaza liberada: ${r.error}`,
        metadata: { channel: "email", kind: "trial_reconfirm_released", class_id: c.id },
      });
    }

    // Sin otra trial futura → el lead vuelve a "en conversación".
    const { data: remaining } = await sb.from("classes").select("id")
      .eq("lead_id", lead.id).eq("is_trial", true).eq("status", "scheduled")
      .gte("scheduled_at", new Date().toISOString()).limit(1);
    if (!remaining || remaining.length === 0) {
      const update: Record<string, unknown> = { trial_scheduled_at: null };
      if (lead.status === "trial_scheduled" || lead.status === "trial_reminded") update.status = "in_conversation";
      await sb.from("leads").update(update).eq("id", lead.id);
    }
    result.released.push(c.id);
  }

  return NextResponse.json({ ok: true, ...result });
}
