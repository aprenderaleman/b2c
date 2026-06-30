import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { signRecordingUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole(["superadmin"]);

  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: rec } = await sb
    .from("recordings")
    .select("id, file_url, status")
    .eq("id", id)
    .maybeSingle();

  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const fileUrl = (rec as { file_url: string | null }).file_url;
  const status = (rec as { status: string }).status;

  if (status !== "ready" || !fileUrl) {
    return NextResponse.json({ error: "not_ready" }, { status: 400 });
  }

  const signedUrl = await signRecordingUrl(fileUrl, 6 * 3600);
  return NextResponse.json({ ok: true, url: signedUrl });
}
