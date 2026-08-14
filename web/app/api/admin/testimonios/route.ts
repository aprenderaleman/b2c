import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { uploadObject } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TAGS = new Set([
  "general", "work", "studies", "pareja", "tiempo", "precio",
  "visa", "travel", "already_in_dach",
]);

const MAX_BYTES = 15 * 1024 * 1024;   // 15 MB max por audio
const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/mp4", "audio/x-m4a"]);

async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || !["admin", "superadmin"].includes(role ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return { userId: (session.user as { id: string }).id };
}

/**
 * GET — lista todos los testimonials (activos e inactivos, orden reciente).
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("testimonials")
    .select("id, nombre_estudiante, audio_url, meta_tag, transcripcion, active, created_at")
    .order("created_at", { ascending: false });
  return NextResponse.json({ items: data ?? [] });
}

/**
 * POST — sube un audio nuevo. multipart/form-data con:
 *   - file: el mp3/ogg/m4a
 *   - meta_tag: general|work|studies|pareja|tiempo|precio|visa|travel|already_in_dach
 *   - transcripcion?: string
 *
 * El nombre_estudiante se toma del filename sin extensión (ej. "Maria Lopez.mp3" → "Maria Lopez").
 */
export async function POST(req: Request) {
  const authRes = await requireAdmin();
  if (authRes instanceof NextResponse) return authRes;

  const form = await req.formData();
  const file = form.get("file");
  const metaTag = String(form.get("meta_tag") ?? "general");
  const transcripcion = form.get("transcripcion") ? String(form.get("transcripcion")) : null;

  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });
  if (!VALID_TAGS.has(metaTag)) return NextResponse.json({ error: "invalid_meta_tag" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "invalid_mime", got: file.type }, { status: 400 });
  }

  // Nombre estudiante desde filename
  const filename = file.name || "testimonial.mp3";
  const nombre = filename.replace(/\.[^.]+$/, "").trim() || "Estudiante";

  // Key R2: testimonials/<uuid>-<safename>
  const uuid = crypto.randomUUID();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `testimonials/${uuid}-${safeName}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadObject(key, buf, file.type || "audio/mpeg");
  if (!uploaded.ok) {
    return NextResponse.json({ error: "upload_failed", detail: uploaded.error }, { status: 500 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("testimonials")
    .insert({
      nombre_estudiante: nombre,
      audio_url:         uploaded.url,
      audio_key:         key,
      meta_tag:          metaTag,
      transcripcion,
      active:            true,
      uploaded_by:       authRes.userId,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: "db_insert_failed", detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: (data as { id: string }).id, nombre_estudiante: nombre });
}
