import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { authorizeAulaAccess } from "@/lib/aula";
import { logClassHoursAndRollup } from "@/lib/finance";

/**
 * POST /api/aula/[id]/end
 *
 * Body: { actualDurationMinutes: number }
 *
 * Called by the teacher after confirming how long the class actually
 * ran. Sets status='completed', ended_at, actual_duration_minutes.
 *
 * Only the host teacher (or admin) can end a class.
 */
const Body = z.object({
  actualDurationMinutes: z.coerce.number().int().min(1).max(240),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const access = await authorizeAulaAccess(id, userId, role);
  if (!access.ok || (access.role !== "host" && role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Fetch teacher_id from the class so we can log hours.
  const { data: cls } = await sb
    .from("classes")
    .select("teacher_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Mark attendance: any participant who never marked "joined" stays as null
  // (admin can flip later). Every participant who DID appear in the room is
  // already set via LiveKit webhooks (Phase 6 wiring). For now just mark
  // the class completed.
  const { error } = await sb
    .from("classes")
    .update({
      status:                  "completed",
      ended_at:                new Date().toISOString(),
      actual_duration_minutes: parsed.data.actualDurationMinutes,
    })
    .eq("id", id)
    .in("status", ["live", "scheduled"]);   // allow end-without-start too
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log hours into the teacher's monthly earnings aggregate. Best-effort:
  // if this fails the class is still completed — admin can re-run rollup.
  try {
    await logClassHoursAndRollup({
      classId:         id,
      teacherId:       (cls as { teacher_id: string }).teacher_id,
      durationMinutes: parsed.data.actualDurationMinutes,
    });
  } catch (e) {
    console.error("logClassHoursAndRollup failed:", e);
  }

  return NextResponse.json({ ok: true });
}
