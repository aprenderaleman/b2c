import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().trim().min(1).max(200),
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
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("classes")
    .insert({
      type:                  "individual",
      teacher_id:            teacher.id,
      title:                 parsed.data.title,
      scheduled_at:          new Date().toISOString(),
      duration_minutes:      120,
      status:                "scheduled",
      is_content_recording:  true,
      is_trial:              false,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
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
  const { data, error } = await sb
    .from("classes")
    .select(`
      id, title, status, scheduled_at, created_at,
      recordings(id, status, file_url, duration_seconds, file_size_bytes, downloadable, created_at)
    `)
    .eq("teacher_id", teacher.id)
    .eq("is_content_recording", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessions: data ?? [] });
}
