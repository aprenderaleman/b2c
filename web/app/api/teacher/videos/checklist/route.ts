import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { VALID_KEYS } from "@/lib/video-checklist";

export const runtime = "nodejs";

const Body = z.object({
  key: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const teacher = await getTeacherByUserId((session.user as { id: string }).id);
  if (!teacher) return NextResponse.json({ error: "no_teacher_profile" }, { status: 404 });

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  if (!VALID_KEYS.has(parsed.data.key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from("video_checklist_progress")
    .select("item_key")
    .eq("teacher_id", teacher.id)
    .eq("item_key", parsed.data.key)
    .maybeSingle();

  if (existing) {
    await sb
      .from("video_checklist_progress")
      .delete()
      .eq("teacher_id", teacher.id)
      .eq("item_key", parsed.data.key);
    return NextResponse.json({ ok: true, checked: false });
  }

  await sb
    .from("video_checklist_progress")
    .insert({ teacher_id: teacher.id, item_key: parsed.data.key });

  return NextResponse.json({ ok: true, checked: true });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const teacher = await getTeacherByUserId((session.user as { id: string }).id);
  if (!teacher) return NextResponse.json({ error: "no_teacher_profile" }, { status: 404 });

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("video_checklist_progress")
    .select("item_key, completed_at")
    .eq("teacher_id", teacher.id);

  const completed: Record<string, string> = {};
  for (const row of data ?? []) {
    completed[(row as { item_key: string }).item_key] = (row as { completed_at: string }).completed_at;
  }

  return NextResponse.json({ ok: true, completed });
}
