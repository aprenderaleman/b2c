import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const BUCKET = "comunidad";
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

/**
 * POST /api/community/upload
 * Body: { filename, content_type, size }
 *
 * Returns a signed upload URL so the browser uploads directly to
 * Supabase Storage — bypasses Vercel's ~4.5 MB body limit entirely.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  if (!body?.filename || !body?.content_type) {
    return NextResponse.json({ error: "filename and content_type required" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(body.content_type)) {
    return NextResponse.json({ error: "Solo se permiten JPEG, PNG, WebP y GIF" }, { status: 400 });
  }
  if (body.size && body.size > MAX_SIZE) {
    return NextResponse.json({ error: "Máximo 10 MB" }, { status: 400 });
  }

  const clean = (body.filename as string).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${userId}/${crypto.randomUUID()}-${clean}`;

  const sb = supabaseAdmin();

  const { data: uploadData, error: uploadErr } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (uploadErr || !uploadData) {
    console.error("[community/upload] signed URL failed:", uploadErr);
    return NextResponse.json({ error: "No se pudo preparar la subida" }, { status: 500 });
  }

  return NextResponse.json({
    upload_url: uploadData.signedUrl,
    upload_token: uploadData.token,
    path,
  });
}

/**
 * PUT /api/community/upload?path=...
 *
 * Called after the browser finishes uploading to Supabase Storage.
 * Returns a signed download URL for displaying the image.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  if (!path.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: signed, error: sgErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (sgErr || !signed) {
    return NextResponse.json({ error: "No se pudo generar la URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, path });
}
