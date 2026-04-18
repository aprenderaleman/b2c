import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { checkAndIssueAutoCertificates } from "@/lib/certificates";

/**
 * POST /api/classes/[id]/attendance
 *
 * Bulk-set attended flags on class_participants for a completed class.
 * Allowed to: owning teacher, admin, superadmin.
 *
 * Body: { participants: [{ student_id: uuid, attended: boolean }, …] }
 */

const Body = z.object({
  participants: z.array(z.object({
    student_id: z.string().uuid(),
    attended:   z.boolean(),
  })).min(1).max(50),
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

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me || me.id !== (cls as { teacher_id: string }).teacher_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Update each participant row. We don't use bulk upsert because we want
  // to keep the joined_at / left_at fields that LiveKit webhooks may have
  // set untouched.
  const results = await Promise.all(
    parsed.data.participants.map(p =>
      sb.from("class_participants")
        .update({ attended: p.attended })
        .eq("class_id", id)
        .eq("student_id", p.student_id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: "update_failed", message: failed.error.message }, { status: 500 });
  }

  // Check certificate thresholds for every student whose attendance was
  // just flipped to true. Best-effort, non-blocking for the response.
  const attendedNow = parsed.data.participants.filter(p => p.attended).map(p => p.student_id);
  Promise.all(attendedNow.map(sid => checkAndIssueAutoCertificates(sid)))
    .catch(e => console.error("auto-certificate check failed:", e));

  return NextResponse.json({ ok: true, updated: parsed.data.participants.length });
}
