import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { createNotification } from "@/lib/notifications";

/**
 * POST /api/homework  — create a homework assignment for a class.
 * Caller must be the teacher of that class (or admin/superadmin).
 */

const Body = z.object({
  classId:      z.string().uuid(),
  title:        z.string().trim().min(2).max(200),
  description:  z.string().trim().max(4000).nullable().default(null),
  dueDate:      z.string().datetime().nullable().default(null),
  attachments:  z.array(z.object({
    url:  z.string().url(),
    name: z.string().max(200),
  })).max(10).default([]),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
    .select("id, teacher_id, title")
    .eq("id", parsed.data.classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  // Teachers can only assign homework to their own classes.
  let teacherId: string | null = null;
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me || me.id !== (cls as { teacher_id: string }).teacher_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    teacherId = me.id;
  } else {
    teacherId = (cls as { teacher_id: string }).teacher_id;
  }

  const { data: inserted, error: insErr } = await sb
    .from("homework_assignments")
    .insert({
      class_id:    parsed.data.classId,
      teacher_id:  teacherId,
      title:       parsed.data.title,
      description: parsed.data.description,
      due_date:    parsed.data.dueDate,
      attachments: parsed.data.attachments,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json({ error: "insert_failed", message: insErr?.message }, { status: 500 });
  }

  // Notify every student in the class.
  const { data: parts } = await sb
    .from("class_participants")
    .select("students!inner(user_id)")
    .eq("class_id", parsed.data.classId);

  const userIds: string[] = [];
  for (const p of (parts ?? []) as Array<{ students: unknown }>) {
    const s = Array.isArray(p.students) ? p.students[0] : p.students;
    const uid = (s as { user_id?: string } | null)?.user_id;
    if (uid) userIds.push(uid);
  }

  await Promise.all(userIds.map(uid =>
    createNotification({
      user_id:  uid,
      type:     "homework_new",
      title:    "Nueva tarea asignada",
      body:     `${parsed.data.title} — ${(cls as { title: string }).title}`,
      link:     "/estudiante/tareas",
      class_id: parsed.data.classId,
    })
  ));

  return NextResponse.json({ ok: true, assignmentId: inserted.id });
}
