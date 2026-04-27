import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { addStudentToGroup } from "@/lib/group-membership";

/**
 * POST /api/admin/groups/[id]/members
 * Body: { student_id: uuid }
 *
 * Add a student to a group. Idempotent — adding an already-member is
 * a no-op and returns ok:true. Admin-only.
 *
 * Now propagates: the student is also enrolled in every future
 * scheduled class of the group, and gets a one-shot summary email +
 * in-app notification. See lib/group-membership.ts.
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

  // Sanity: group and student must both exist before we go propagating.
  const [{ data: group }, { data: student }] = await Promise.all([
    sb.from("student_groups").select("id").eq("id", groupId).maybeSingle(),
    sb.from("students").select("id").eq("id", parsed.data.student_id).maybeSingle(),
  ]);
  if (!group)   return NextResponse.json({ error: "group_not_found"   }, { status: 404 });
  if (!student) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  const result = await addStudentToGroup(groupId, parsed.data.student_id);
  if (!result.ok) {
    return NextResponse.json({ error: "add_failed", message: result.reason }, { status: 500 });
  }
  return NextResponse.json({ ok: true, classesAffected: result.classesAffected });
}
