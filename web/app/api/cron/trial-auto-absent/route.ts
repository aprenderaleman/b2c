import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { Resend } from "resend";

/**
 * GET/POST /api/cron/trial-auto-absent
 *
 * ⚠️ REESCRITO 2026-08-02 tras política no-auto-cancel.
 *
 * ANTES: cerraba automáticamente clases sin marcar 24h después,
 * seteaba `leads.status='trial_absent'` y entraba en el flow
 * AWAITING_ABSENT_INTEREST (que a su vez podía marcar `lost` con
 * un simple "no" del lead — cascada destructiva). Ver auditoría
 * en docs/audit-destructive-automations-2026-08.md.
 *
 * AHORA: patrón **notificar-no-actuar**. Detecta los mismos leads
 * ("scheduled_at > 24h atrás sin marker") y:
 *   1. Inserta timeline entry `type='agent_note'` con badge
 *      "⏰ pendiente marcar asistencia".
 *   2. Manda 1 email diario a admin con la lista pendiente.
 *   3. NO modifica leads.status, NO cancela clases, NO inicia
 *      absent-interest flow.
 *
 * Los humanos (profe/admin) marcan attended/absent desde su hub.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const GRACE_HOURS = 24;
const ALERT_EMAIL = process.env.NEW_LEAD_ALERT_EMAIL ?? "";
const RESEND_KEY  = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@aprender-aleman.de";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 3600_000).toISOString();

  const { data: candidates, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, trial_scheduled_at, status")
    .lt("trial_scheduled_at", cutoff)
    .is("trial_attended_at", null)
    .is("trial_absent_at", null)
    .not("status", "in", "(converted,lost,trial_attended,trial_absent)")
    .order("trial_scheduled_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "select_failed", detail: error.message }, { status: 500 });
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, scanned: 0 });
  }

  // Guard: no re-anotar leads que ya tienen el badge de hoy (evita
  // spam en el timeline si el cron corre 2×/día).
  const todayIso = new Date().toISOString().slice(0, 10);
  let notified = 0;
  for (const r of rows) {
    // Check si ya tiene entry hoy
    const { data: existingToday } = await sb
      .from("lead_timeline")
      .select("id")
      .eq("lead_id", r.id)
      .eq("type", "agent_note")
      .filter("metadata->>kind", "eq", "trial_pending_review")
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .limit(1);
    if (existingToday && existingToday.length > 0) continue;

    await sb.from("lead_timeline").insert({
      lead_id: r.id,
      type:    "agent_note",
      author:  "system",
      content: `⏰ Trial pendiente marcar asistencia — clase fue el ${r.trial_scheduled_at?.slice(0, 16)} y aún no está attended/absent. Revisar en /admin/leads/${r.id} y marcar manualmente.`,
      metadata: {
        kind:               "trial_pending_review",
        trial_scheduled_at: r.trial_scheduled_at,
        current_status:     r.status,
        auto_note_date:     todayIso,
      },
    }).then(() => {}, () => {});
    notified++;
  }

  // Email digest diario al admin — solo si hay pendientes.
  if (notified > 0 && ALERT_EMAIL && RESEND_KEY) {
    try {
      const lines = [
        `${rows.length} trials pendientes de marcar attended/absent (>24h desde la clase).`,
        "",
        "Revisar en /admin/leads o /profesor/clasedeprueba:",
        "",
      ];
      for (const r of rows.slice(0, 30)) {
        lines.push(`  · ${r.name ?? r.email ?? r.id.slice(0, 8)} — clase ${r.trial_scheduled_at?.slice(0, 16)} — status=${r.status}`);
      }
      if (rows.length > 30) lines.push(`  ... y ${rows.length - 30} más`);
      lines.push("");
      lines.push("El sistema NO marca absent automáticamente (política 2026-08-02). Marcar a mano.");

      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from:    RESEND_FROM,
        to:      ALERT_EMAIL,
        subject: `📋 ${rows.length} trials pendientes de marcar asistencia`,
        text:    lines.join("\n"),
      });
    } catch (err) {
      console.error("[trial-auto-absent] email digest failed:", err);
    }
  }

  return NextResponse.json({
    ok:                true,
    scanned:           rows.length,
    notified,
    pattern:           "notify_only_no_action",
    policy_doc:        "docs/no-auto-cancel-policy.md",
  });
}
