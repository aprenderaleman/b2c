import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/groups/[id]/members
 * Body: { student_id: uuid }
 *
 * Add a student to a group. Idempotent — adding an already-member is a
 * no-op and returns ok:true. Admin-only.
 *
 * Does NOT retro-add the student to already-scheduled classes for this
 * group (per Gelfis: only future classes should include them). Future
 * classes created from the group will include all current members via
 * the normal class-create flow.
 */
export const runtime = "nodejs";

const Body = z.object({ student_id: z.string().uuid() });

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { err: null };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id: groupId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Sanity: group and student must both exist.
  const [{ data: group }, { data: student }] = await Promise.all([
    sb.from("student_groups").select("id").eq("id", groupId).maybeSingle(),
    sb.from("students").select("id").eq("id", parsed.data.student_id).maybeSingle(),
  ]);
  if (!group)   return NextResponse.json({ error: "group_not_found"   }, { status: 404 });
  if (!student) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  // Upsert — PK is (group_id, student_id) so duplicates just no-op.
  const { error } = await sb
    .from("student_group_members")
    .upsert({ group_id: groupId, student_id: parsed.data.student_id },
            { onConflict: "group_id,student_id" });
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
