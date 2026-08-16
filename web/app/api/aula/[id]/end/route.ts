import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { authorizeAulaAccess } from "@/lib/aula";
import { logClassHoursAndRollup } from "@/lib/finance";

/**
 * POST /api/aula/[id]/end
 *
 * Body: { actualDurationMinutes?: number }
 *
 * Called by the teacher to end a class. Duration is auto-calculated
 * from started_at → now. The optional field is accepted for backwards
 * compatibility but ignored — the real duration comes from the timer.
 *
 * Only the host teacher (or admin) can end a class.
 */
const Body = z.object({
  actualDurationMinutes: z.coerce.number().int().min(1).max(240).optional(),
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

  // Fetch class details including started_at for auto-duration.
  const { data: cls } = await sb
    .from("classes")
    .select("teacher_id, status, is_content_recording, started_at")
    .eq("id", id)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Auto-calculate duration from started_at to now (no manual input needed).
  const now = new Date();
  const startedAt = (cls as { started_at: string | null }).started_at;
  let actualMinutes: number;
  if (startedAt) {
    actualMinutes = Math.round((now.getTime() - new Date(startedAt).getTime()) / 60000);
    if (actualMinutes < 1) actualMinutes = 1;
    if (actualMinutes > 240) actualMinutes = 240;
  } else {
    actualMinutes = parsed.data.actualDurationMinutes ?? 50;
  }

  const { error } = await sb
    .from("classes")
    .update({
      status:                  "completed",
      ended_at:                now.toISOString(),
      actual_duration_minutes: actualMinutes,
    })
    .eq("id", id)
    .in("status", ["live", "scheduled"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Skip billing for content recording sessions (YouTube videos etc.)
  if (!(cls as { is_content_recording?: boolean }).is_content_recording) {
    try {
      await logClassHoursAndRollup({
        classId:         id,
        teacherId:       (cls as { teacher_id: string }).teacher_id,
        durationMinutes: actualMinutes,
      });
    } catch (e) {
      console.error("logClassHoursAndRollup failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
