import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DELETE /api/admin/groups/{id}/purge — HARD delete.
 *
 * Nukes the group and EVERYTHING tied to it:
 *   - student_group_members (CASCADE on student_groups)
 *   - all classes WHERE group_id = X (regardless of status)
 *   - class_participants of those classes (CASCADE on classes)
 *   - notifications, recordings, homework, chat, etc. tied to those
 *     classes (all CASCADE on classes via FK)
 *
 * Versus the soft DELETE on /api/admin/groups/{id}, which just flips
 * `active=false` and leaves history intact. This route is for "I made a
 * mistake creating this, wipe it out" — irreversible.
 *
 * Admin-only.
 */
export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { err: null };
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id } = await params;

  const sb = supabaseAdmin();

  // 0. Verify the group exists (so we can return a clean 404).
  const { data: existing, error: lookupErr } = await sb
    .from("student_groups")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: "lookup_failed", message: lookupErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 1. Count + delete every class belonging to the group. Cascades take
  //    care of class_participants, notifications, recordings, homework,
  //    chat threads, finance.class_invoices, etc.
  const { data: classRows, error: classLookupErr } = await sb
    .from("classes")
    .select("id")
    .eq("group_id", id);
  if (classLookupErr) {
    return NextResponse.json({ error: "classes_lookup_failed", message: classLookupErr.message }, { status: 500 });
  }
  const classCount = (classRows ?? []).length;

  if (classCount > 0) {
    const { error: classDelErr } = await sb
      .from("classes")
      .delete()
      .eq("group_id", id);
    if (classDelErr) {
      return NextResponse.json(
        { error: "classes_delete_failed", message: classDelErr.message },
        { status: 500 },
      );
    }
  }

  // 2. Delete the group row. student_group_members rows go with it via
  //    ON DELETE CASCADE.
  const { error: groupDelErr } = await sb
    .from("student_groups")
    .delete()
    .eq("id", id);
  if (groupDelErr) {
    return NextResponse.json(
      { error: "group_delete_failed", message: groupDelErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, classesDeleted: classCount });
}
