import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { deleteRecordingObject } from "@/lib/r2";

/**
 * DELETE /api/admin/recordings/[id]
 *
 * Hard-delete a recording: removes the .mp4 from R2 first (best-effort)
 * and then drops the DB row. If the R2 delete fails, we still drop the
 * DB row so the UI stops showing ghost entries — the orphan object
 * will age out naturally.
 *
 * Admin-only. Destructive, irreversible.
 */
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: rec } = await sb
    .from("recordings")
    .select("id, file_url")
    .eq("id", id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let r2Deleted = true;
  const fileUrl = (rec as { file_url: string | null }).file_url;
  if (fileUrl) {
    r2Deleted = await deleteRecordingObject(fileUrl);
  }

  const { error: delErr } = await sb.from("recordings").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json(
      { error: "db_delete_failed", message: delErr.message, r2_deleted: r2Deleted },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, r2_deleted: r2Deleted });
}
