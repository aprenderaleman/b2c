import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { signRecordingUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole: role as "teacher" | "admin" | "superadmin",
    expectRole: "teacher",
  });
  const teacher = await getTeacherByUserId(eff.userId);
  if (!teacher) return NextResponse.json({ error: "no_teacher_profile" }, { status: 404 });

  const { id: recordingId } = await params;
  const sb = supabaseAdmin();

  const { data: rec } = await sb
    .from("recordings")
    .select(`
      id, file_url, status,
      class:classes!inner(teacher_id, is_content_recording)
    `)
    .eq("id", recordingId)
    .maybeSingle();

  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const cls = Array.isArray((rec as Record<string, unknown>).class)
    ? ((rec as Record<string, unknown>).class as Array<Record<string, unknown>>)[0]
    : (rec as Record<string, unknown>).class as Record<string, unknown>;

  if (cls?.teacher_id !== teacher.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const fileUrl = (rec as { file_url: string | null }).file_url;
  const status = (rec as { status: string }).status;

  if (status !== "ready" || !fileUrl) {
    return NextResponse.json({ error: "not_ready" }, { status: 400 });
  }

  const signedUrl = await signRecordingUrl(fileUrl, 6 * 3600);
  return NextResponse.json({ ok: true, url: signedUrl });
}
