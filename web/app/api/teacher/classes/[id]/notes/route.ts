import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const Body = z.object({
  teacher_notes: z.string().trim().max(2000).nullable(),
  shared_with_student: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!cls) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (role === "teacher") {
    const me = await getTeacherByUserId((session.user as { id: string }).id);
    if (!me || me.id !== (cls as { teacher_id: string | null }).teacher_id) {
      return NextResponse.json({ error: "not_your_class" }, { status: 403 });
    }
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.teacher_notes !== undefined) {
    patch.teacher_notes = parsed.data.teacher_notes;
  }
  if (parsed.data.shared_with_student !== undefined) {
    patch.notes_shared_with_student = parsed.data.shared_with_student;
  }

  const { error } = await sb.from("classes").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
