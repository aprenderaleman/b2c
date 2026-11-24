import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { signRecordingUrl } from "@/lib/r2";

/**
 * GET /api/student/recordings/{id}/download — descarga de una grabación
 * propia (Bono de Acción Rápida, Gelfis 2026-11-26). Autoriza si:
 *   · el usuario es admin/superadmin, o
 *   · es un alumno con recordings_enabled que participó en la clase, o
 *   · la clase es SU trial (students.trial_class_id).
 * Redirige 302 a la URL firmada de R2 con Content-Disposition: attachment.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const role = (session.user as { role: string }).role;
  const userId = (session.user as { id: string }).id;

  const sb = supabaseAdmin();
  const { data: rec } = await sb
    .from("recordings")
    .select("id, class_id, file_url, status, class:classes!inner(scheduled_at)")
    .eq("id", id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const r = rec as { class_id: string; file_url: string | null; status: string; class: { scheduled_at: string } | Array<{ scheduled_at: string }> };
  if (r.status !== "ready" || !r.file_url) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  if (role !== "admin" && role !== "superadmin") {
    if (role !== "student") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: stu } = await sb
      .from("students")
      .select("id, recordings_enabled, trial_class_id")
      .eq("user_id", userId)
      .maybeSingle();
    const s = stu as { id: string; recordings_enabled: boolean; trial_class_id: string | null } | null;
    if (!s?.recordings_enabled) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const isOwnTrial = s.trial_class_id === r.class_id;
    if (!isOwnTrial) {
      const { data: part } = await sb
        .from("class_participants")
        .select("class_id")
        .eq("class_id", r.class_id)
        .eq("student_id", s.id)
        .maybeSingle();
      if (!part) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const cls = Array.isArray(r.class) ? r.class[0] : r.class;
  const fecha = new Date(cls.scheduled_at).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const url = await signRecordingUrl(r.file_url, undefined, `clase-aleman-${fecha}.mp4`);
  return NextResponse.redirect(url, { status: 302 });
}
