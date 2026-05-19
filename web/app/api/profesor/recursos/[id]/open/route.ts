import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { signRecordingUrl } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profesor/recursos/{id}/open
 *
 * Devuelve la URL utilizable para abrir el recurso:
 *   - kind=pdf|doc: signed URL temporal a R2 (válida 6h).
 *   - kind=video_link|source_link: external_url directa.
 *
 * Incrementa atómicamente open_count en BD.
 *
 * Auth: cualquier rol logueado (profesores, admins). Los alumnos
 * no tienen acceso a la biblioteca de recursos para profesores.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teacher_resources")
    .select("id, kind, file_url, external_url")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const r = data as { id: string; kind: string; file_url: string | null; external_url: string | null };

  let openUrl: string | null = null;
  if (r.kind === "pdf" || r.kind === "doc") {
    if (!r.file_url) {
      return NextResponse.json({ error: "no_file" }, { status: 404 });
    }
    openUrl = await signRecordingUrl(r.file_url);
  } else {
    openUrl = r.external_url;
  }

  if (!openUrl) {
    return NextResponse.json({ error: "no_target" }, { status: 404 });
  }

  // Best-effort: incrementar contador
  void sb.rpc("increment_resource_open_count", { resource_id: id });

  return NextResponse.json(
    { ok: true, url: openUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
