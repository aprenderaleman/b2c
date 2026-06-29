import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { sendPackCompletedEmail, sendPackLowBalanceEmail } from "@/lib/email/send";

/**
 * GET /api/cron/pack-alerts
 *
 * Runs hourly. Detects students whose classes_remaining just hit 5 or 0
 * and sends them email + in-app notification. Idempotent: deduplicates
 * against existing notifications with matching title per user.
 *
 * Thresholds:
 *   - 5 remaining → "te quedan 5 clases" nudge
 *   - 0 remaining → "felicidades, completaste tu plan" + feedback ask
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const WHATSAPP_URL = "https://wa.me/4917684930450";

const THRESHOLDS = [
  {
    remaining: 0,
    notifTitle: "Has completado tu plan — felicidades!",
    notifBody: (total: number) =>
      `Felicidades! Has completado tus ${total} clases. Cuéntanos cómo ha sido tu experiencia y comunícate con Gelfis Horn para los siguientes pasos.`,
    sendEmail: "completed" as const,
  },
  {
    remaining: 5,
    notifTitle: "Te quedan 5 clases en tu plan",
    notifBody: (_total: number) =>
      "Te quedan 5 clases en tu plan actual. Comunícate con Gelfis Horn para coordinar los siguientes pasos.",
    sendEmail: "low_balance" as const,
  },
];

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const sent: Array<{ name: string; threshold: number; email: boolean; notif: boolean }> = [];

  for (const t of THRESHOLDS) {
    // Find students at this threshold with an active-ish subscription
    const { data: students } = await sb
      .from("students")
      .select("id, user_id, classes_purchased, classes_remaining, users!inner(full_name, email)")
      .eq("classes_remaining", t.remaining)
      .gt("classes_purchased", 0);

    if (!students?.length) continue;

    for (const raw of students) {
      const s = raw as Record<string, unknown>;
      const u = s.users as Record<string, unknown>;
      const userId = s.user_id as string;
      const fullName = (u.full_name as string) ?? "Estudiante";
      const email = u.email as string;
      const totalClasses = s.classes_purchased as number;

      // Dedup: check if we already sent this exact notification
      const { data: existing } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("title", t.notifTitle)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Send email
      let emailOk = false;
      if (t.sendEmail === "completed") {
        const r = await sendPackCompletedEmail(email, {
          name: fullName,
          totalClasses,
          whatsappUrl: WHATSAPP_URL,
        });
        emailOk = r.ok;
      } else {
        const r = await sendPackLowBalanceEmail(email, {
          name: fullName,
          remaining: t.remaining,
          whatsappUrl: WHATSAPP_URL,
        });
        emailOk = r.ok;
      }

      // In-app notification
      let notifOk = false;
      try {
        const id = await createNotification({
          user_id: userId,
          type: "generic",
          title: t.notifTitle,
          body: t.notifBody(totalClasses),
        });
        notifOk = !!id;
      } catch { /* swallow */ }

      sent.push({ name: fullName, threshold: t.remaining, email: emailOk, notif: notifOk });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: sent.length,
    details: sent,
  });
}
