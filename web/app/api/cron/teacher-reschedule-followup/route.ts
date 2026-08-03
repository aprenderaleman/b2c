import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { resolveChainVariables } from "@/lib/chain-variables";
import { renderTemplate } from "@/lib/message-stats";

/**
 * GET/POST /api/cron/teacher-reschedule-followup
 *
 * Único follow-up tras "Reagendar" del profesor
 * (sendRescheduleLinkMessage en admin-actions.ts).
 *
 *   FU → +24h sin rebook (kind trial_teacher_reschedule_fu2, último)
 *
 * FU1 +8h eliminado 2026-08-01 (Gelfis): reducía carga sin sacrificar
 * captación — el FU2 +24h sigue recuperando la mayor parte.
 *
 * Detecta leads con status='rescheduling' + reschedule_state.source='teacher'
 * y compara delta UTC contra reschedule_state.link_sent_at.
 *
 * Si el lead ya reagendó (creó una nueva clase trial después de link_sent_at)
 * cierra el flow (phase='DONE') y no manda nada más.
 *
 * Idempotencia: followup2_sent_at bloquea re-envío.
 * Schedule: cada 30 min.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

type RS = {
  phase?: string;
  source?: string;
  link_sent_at?: string;
  followup2_sent_at?: string | null;
};

async function run(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorisedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();

  const { data: leads } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, ai_paused_until, reschedule_state")
    .eq("status", "rescheduling")
    .not("reschedule_state", "is", null);

  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0 });
  }

  const nowMs = Date.now();
  const TWENTYFOUR_H = 24 * 3600_000;

  let sentFu2 = 0, skipped = 0, failed = 0, closed = 0;

  for (const l of leads) {
    const rs = (l as { reschedule_state: RS | null }).reschedule_state;
    if (!rs || rs.source !== "teacher" || !rs.link_sent_at) { skipped++; continue; }
    if (rs.followup2_sent_at) { skipped++; continue; }

    // ¿El lead ya rebookeó? Cierra flow.
    const { data: newClass } = await sb
      .from("classes")
      .select("id")
      .eq("lead_id", l.id)
      .eq("is_trial", true)
      .eq("status", "scheduled")
      .gt("created_at", rs.link_sent_at)
      .limit(1)
      .maybeSingle();
    if (newClass) {
      await sb.from("leads")
        .update({ reschedule_state: { ...rs, phase: "DONE", rebooked_class_id: (newClass as { id: string }).id } })
        .eq("id", l.id);
      await sb.from("lead_timeline").insert({
        lead_id: l.id,
        type: "agent_note",
        author: "system",
        content: "✓ Lead reagendó tras reagendamiento del profesor — flow cerrado",
        metadata: { kind: "teacher_reschedule_completed", new_class_id: (newClass as { id: string }).id },
      });
      closed++;
      continue;
    }

    if (l.ai_paused_until && new Date(l.ai_paused_until).getTime() > nowMs) { skipped++; continue; }
    if (!l.whatsapp_normalized) { skipped++; continue; }

    const linkAt = new Date(rs.link_sent_at).getTime();
    const elapsed = nowMs - linkAt;
    const firstName = ((l.name ?? "").split(/\s+/)[0]) || (l.name ?? "");
    const rescheduleUrl = `${PLATFORM_URL}/agendar/cuando?lead=${l.id}&from=teacher_reschedule`;

    // FU2 (+24h) tiene prioridad — si ya toca y no se ha mandado, va.
    if (elapsed >= TWENTYFOUR_H && !rs.followup2_sent_at) {
      // Copy AUTHORING_RULES-compliant (Gelfis 2026-08-01): sin escasez
      // inventada, sin binario de salida. Variables reales via
      // resolveChainVariables (mismo helper que el motor de cadenas).
      const vars = await resolveChainVariables(l.id, {}, rs.link_sent_at);
      const bodyTpl = `{nombre}, tu clase quedó pendiente de nueva fecha 📅 Elige tu horario cuando quieras: {url} — y si prefieres que te llamemos y lo vemos juntos, dímelo 😊`;
      const text = renderTemplate(bodyTpl, { ...vars, url: rescheduleUrl });
      // firstName referenciado solo por logs — evita warn unused.
      void firstName;

      const res = await sendWhatsappText(l.whatsapp_normalized, text, { kind: "trial_teacher_reschedule_fu2" });
      if (res.ok) {
        sentFu2++;
        await sb.from("lead_timeline").insert({
          lead_id: l.id,
          type:    "system_message_sent",
          author:  "system",
          content: text,
          metadata: { kind: "trial_teacher_reschedule_fu2", channel: "whatsapp", message_id: res.messageId },
        });
        await sb.from("leads")
          .update({ reschedule_state: { ...rs, followup2_sent_at: new Date().toISOString() } })
          .eq("id", l.id);
      } else {
        failed++;
        console.error(`[teacher-reschedule-followup] FU2 failed for ${l.id}: ${res.reason}`);
        await sb.from("lead_timeline").insert({
          lead_id: l.id,
          type: "send_failed",
          author: "system",
          content: `💬 Falló FU2 teacher-reschedule`,
          metadata: { kind: "trial_teacher_reschedule_fu2", error: res.reason },
        });
      }
      continue;
    }

    skipped++;
  }

  return NextResponse.json({
    ok: true,
    candidates: leads.length,
    sentFu2, closed, skipped, failed,
  });
}
