import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { uploadObject } from "@/lib/r2";
import type { ResourceKind, ResourceLevel } from "@/lib/teacher-resources";

/**
 * POST /api/profesor/recursos
 *
 * Multipart upload de un recurso a la biblioteca compartida de profesores.
 *
 * Form fields:
 *   - title          (required, ≤ 200 chars)
 *   - description    (optional)
 *   - level          (required: A0|A1|A2|B1|B2|C1|C2|XX)
 *   - topic          (required, ≤ 80 chars)
 *   - kind           (required: pdf|doc|video_link|source_link)
 *   - tags           (optional, comma-separated string)
 *   - file           (required if kind ∈ {pdf, doc}; archivo)
 *   - external_url   (required if kind ∈ {video_link, source_link})
 *
 * Auth: profesor logueado (o admin/superadmin).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LEVELS: ResourceLevel[] = ["A0","A1","A2","B1","B2","C1","C2","XX"];
const ALLOWED_KINDS: ResourceKind[] = ["pdf","doc","video_link","source_link"];
const MAX_FILE_BYTES = 50 * 1024 * 1024;     // 50 MB por archivo

const MIME_BY_KIND: Record<ResourceKind, string[]> = {
  pdf:         ["application/pdf"],
  doc:         [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ],
  video_link:   [],
  source_link:  [],
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userRole = (session.user as { role: string }).role;
  if (userRole !== "teacher" && userRole !== "admin" && userRole !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Para admin/superadmin que no tengan perfil de teacher: no permitir
  // upload (porque uploaded_by es FK a teachers). Si quieres permitirlo
  // en el futuro, podemos hacer uploaded_by nullable y mostrarlo como
  // "Equipo academia".
  const teacher = await getTeacherByUserId((session.user as { id: string }).id);
  if (!teacher) {
    return NextResponse.json(
      { error: "no_teacher_profile", message: "Tu cuenta no tiene perfil de profesor." },
      { status: 403 },
    );
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "invalid_multipart" }, { status: 400 }); }

  const title       = String(form.get("title") || "").trim();
  const description = String(form.get("description") || "").trim() || null;
  const level       = String(form.get("level") || "").trim() as ResourceLevel;
  const topic       = String(form.get("topic") || "").trim();
  const kind        = String(form.get("kind") || "").trim() as ResourceKind;
  const tagsRaw     = String(form.get("tags") || "").trim();
  const externalUrl = String(form.get("external_url") || "").trim() || null;
  const fileEntry   = form.get("file");

  // Validación básica
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "title_required", message: "Título obligatorio (≤200 caracteres)." }, { status: 400 });
  }
  if (!ALLOWED_LEVELS.includes(level)) {
    return NextResponse.json({ error: "level_invalid" }, { status: 400 });
  }
  if (!topic || topic.length > 80) {
    return NextResponse.json({ error: "topic_required", message: "Tema obligatorio (≤80 caracteres)." }, { status: 400 });
  }
  if (!ALLOWED_KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind_invalid" }, { status: 400 });
  }
  const tags = tagsRaw
    ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean).slice(0, 12)
    : [];

  const isFileKind = kind === "pdf" || kind === "doc";
  const isLinkKind = kind === "video_link" || kind === "source_link";

  if (isLinkKind) {
    if (!externalUrl || !/^https?:\/\//i.test(externalUrl)) {
      return NextResponse.json(
        { error: "external_url_invalid", message: "URL externa obligatoria y debe empezar por http:// o https://" },
        { status: 400 },
      );
    }
  }

  let fileMeta: { url: string; key: string; name: string; size: number } | null = null;

  if (isFileKind) {
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: "file_required", message: "Adjunta un archivo PDF o doc." },
        { status: 400 },
      );
    }
    if (fileEntry.size === 0) {
      return NextResponse.json({ error: "file_empty" }, { status: 400 });
    }
    if (fileEntry.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "file_too_big", message: `Máximo ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }
    const mime = fileEntry.type || "application/octet-stream";
    const allowedMimes = MIME_BY_KIND[kind];
    if (allowedMimes.length > 0 && !allowedMimes.includes(mime)) {
      return NextResponse.json(
        { error: "mime_not_allowed", message: `Tipo de archivo no permitido para ${kind}: ${mime}` },
        { status: 415 },
      );
    }

    // Subir a R2 bajo prefix teacher-resources/
    const safeName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "archivo";
    const key = `teacher-resources/${teacher.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const buf = Buffer.from(await fileEntry.arrayBuffer());
    const up = await uploadObject(key, buf, mime);
    if (!up.ok) {
      console.error("[recursos] upload failed:", up.error);
      return NextResponse.json(
        { error: "upload_failed", message: "No se pudo subir el archivo. Reintenta." },
        { status: 502 },
      );
    }
    fileMeta = { url: up.url, key: up.key, name: fileEntry.name, size: fileEntry.size };
  }

  // Insert DB
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("teacher_resources").insert({
    uploaded_by:     teacher.id,
    title,
    description,
    level,
    topic,
    kind,
    tags,
    file_url:        fileMeta?.url ?? null,
    file_name:       fileMeta?.name ?? null,
    file_size_bytes: fileMeta?.size ?? null,
    storage_key:     fileMeta?.key ?? null,
    external_url:    isLinkKind ? externalUrl : null,
  }).select("id").single();

  if (error || !data) {
    console.error("[recursos] insert failed:", error?.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers: { "Cache-Control": "no-store" } });
}
