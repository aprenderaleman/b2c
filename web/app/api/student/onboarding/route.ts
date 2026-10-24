import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recordOnboardingEventByUser } from "@/lib/onboarding";

/**
 * POST /api/student/onboarding { event }  → registra un evento del onboarding
 * (tour_seen, tour_dismissed, checklist_dismissed, cursos, schule, hans, asistente).
 * Profes: mismo endpoint, rol teacher.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "student" && role !== "teacher") return NextResponse.json({ ok: true, skipped: "role" });
  const body = await req.json().catch(() => ({})) as { event?: string };
  if (!body.event) return NextResponse.json({ error: "missing_event" }, { status: 400 });
  await recordOnboardingEventByUser(role, (session.user as { id: string }).id, body.event);
  return NextResponse.json({ ok: true });
}
