import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";
import { computeBillingUnits, rollupTeacherMonth } from "@/lib/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL =
  process.env.ADMIN_ALERT_EMAIL ?? "aprenderaleman2026@gmail.com";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const header = req.headers.get("x-cron-secret");
  return header === secret;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await reconcileHours();
  } catch (err) {
    const e = err as Error;
    console.error("[hours-reconciliation] UNHANDLED:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export const POST = GET;

async function reconcileHours() {
  const sb = supabaseAdmin();
  const now = new Date();

  // Reconcile current month + previous month (catches end-of-month edge cases)
  const months = [
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
  ];

  let totalAutoBilled = 0;
  let totalNeedsReview = 0;
  let totalSkipped = 0;
  const alerts: string[] = [];
  const teachersToRecompute = new Set<string>();

  for (const monthStart of months) {
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)
    );
    const mesLabel = monthStart.toISOString().slice(0, 7);

    // Find all completed non-trial classes with bh=0 for this month
    const { data: unbilled, error } = await sb
      .from("classes")
      .select(`
        id, teacher_id, title, scheduled_at, duration_minutes,
        actual_duration_minutes, is_trial, started_at, ended_at,
        type
      `)
      .eq("status", "completed")
      .eq("is_trial", false)
      .eq("billed_hours", 0)
      .gte("scheduled_at", monthStart.toISOString())
      .lt("scheduled_at", monthEnd.toISOString());

    if (error) {
      alerts.push(`Error querying unbilled classes for ${mesLabel}: ${error.message}`);
      continue;
    }

    for (const cls of (unbilled ?? []) as unknown as Array<{
      id: string; teacher_id: string; title: string; scheduled_at: string;
      duration_minutes: number; actual_duration_minutes: number | null;
      is_trial: boolean; started_at: string | null; ended_at: string | null;
      type: string;
    }>) {
      const { data: teacherUser } = await sb
        .from("teachers")
        .select("id, user_id, rate_individual_cents, rate_group_cents, users!inner(full_name, role)")
        .eq("id", cls.teacher_id)
        .maybeSingle();

      const rawTu = teacherUser as unknown as {
        id: string; user_id: string;
        rate_individual_cents: number; rate_group_cents: number;
        users: { full_name: string; role: string } | Array<{ full_name: string; role: string }>;
      } | null;
      if (!rawTu) continue;
      const tu = {
        ...rawTu,
        users: Array.isArray(rawTu.users) ? rawTu.users[0] : rawTu.users,
      };

      if (!tu.users || tu.users.role !== "teacher") continue;

      // Check recordings
      const { count: recCount } = await sb
        .from("recordings")
        .select("id", { count: "exact", head: true })
        .eq("class_id", cls.id)
        .eq("status", "ready");

      // Determine effective duration
      let effectiveDur: number;
      if (cls.actual_duration_minutes && cls.actual_duration_minutes > 0) {
        effectiveDur = cls.actual_duration_minutes;
      } else if (cls.started_at && cls.ended_at) {
        const diffSec =
          (new Date(cls.ended_at).getTime() - new Date(cls.started_at).getTime()) / 1000;
        effectiveDur = Math.round(diffSec / 60);
      } else {
        effectiveDur = cls.duration_minutes;
      }

      // Skip if actual_duration explicitly < 15 (no-show)
      if (cls.actual_duration_minutes !== null && cls.actual_duration_minutes < 15) {
        totalSkipped++;
        continue;
      }

      const units = computeBillingUnits(effectiveDur);
      if (units === 0) {
        totalSkipped++;
        continue;
      }

      // Determine if we have evidence
      const hasRecording = (recCount ?? 0) > 0;
      const hasActualDuration =
        cls.actual_duration_minutes !== null && cls.actual_duration_minutes >= 15;
      const hasTimer =
        cls.started_at !== null &&
        cls.ended_at !== null &&
        (new Date(cls.ended_at).getTime() - new Date(cls.started_at).getTime()) >= 900_000;

      if (hasRecording || hasActualDuration || hasTimer) {
        // Auto-bill: UPDATE billed_hours triggers the AFTER trigger chain
        const { error: updateErr } = await sb
          .from("classes")
          .update({
            billed_hours: units,
            actual_duration_minutes:
              cls.actual_duration_minutes ?? effectiveDur,
          })
          .eq("id", cls.id);

        if (updateErr) {
          alerts.push(
            `Failed to auto-bill class ${cls.id} (${tu.users.full_name}, ${cls.title}): ${updateErr.message}`
          );
        } else {
          totalAutoBilled++;
          teachersToRecompute.add(cls.teacher_id);
        }
      } else {
        totalNeedsReview++;
        alerts.push(
          `REVIEW: ${tu.users.full_name} — "${cls.title}" (${cls.scheduled_at?.slice(0, 10)}) — no evidence, bh=0`
        );
      }
    }
  }

  // Recompute teacher earnings for affected teachers
  for (const tid of teachersToRecompute) {
    for (const m of months) {
      await rollupTeacherMonth(tid, m);
    }
  }

  // Check for rate misconfigurations
  const { data: badRates } = await sb
    .from("teachers")
    .select("id, rate_individual_cents, rate_group_cents, users!inner(full_name)")
    .eq("active", true)
    .or("rate_individual_cents.eq.0,rate_group_cents.eq.0");

  for (const rawT of (badRates ?? []) as unknown as Array<{
    id: string;
    rate_individual_cents: number;
    rate_group_cents: number;
    users: { full_name: string } | Array<{ full_name: string }>;
  }>) {
    const t = {
      ...rawT,
      users: Array.isArray(rawT.users) ? rawT.users[0] : rawT.users,
    };
    if (!t.users) continue;
    if (t.rate_individual_cents === 0) {
      alerts.push(`RATE: ${t.users.full_name} tiene rate_individual_cents = 0`);
    }
    if (t.rate_group_cents === 0) {
      alerts.push(`RATE: ${t.users.full_name} tiene rate_group_cents = 0`);
    }
  }

  // Send admin alert if anything was found
  if (totalAutoBilled > 0 || totalNeedsReview > 0 || alerts.length > 0) {
    const html = `
      <h3>Reconciliacion de horas — ${now.toISOString().slice(0, 10)}</h3>
      <ul>
        <li><strong>${totalAutoBilled}</strong> clases auto-facturadas (tenian evidencia)</li>
        <li><strong>${totalNeedsReview}</strong> clases pendientes de revision manual</li>
        <li><strong>${totalSkipped}</strong> clases ignoradas (no-show / < 15 min)</li>
      </ul>
      ${alerts.length > 0 ? `<h4>Detalles:</h4><ul>${alerts.map((a) => `<li>${a}</li>`).join("")}</ul>` : ""}
    `;
    await sendRaw(
      ADMIN_EMAIL,
      `${totalAutoBilled > 0 ? "✅" : "⚠️"} Reconciliacion horas ${now.toISOString().slice(0, 10)}`,
      html,
      alerts.join("\n")
    );
  }

  return NextResponse.json({
    ok: true,
    auto_billed: totalAutoBilled,
    needs_review: totalNeedsReview,
    skipped: totalSkipped,
    teachers_recomputed: teachersToRecompute.size,
    alerts: alerts.length,
  });
}
