import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Subida directa navegador → Supabase Storage (Gelfis 2026-10-13: los
 * vídeos se quedaban en "Subiendo…"). Antes el archivo pasaba por la
 * función de Vercel, que corta el cuerpo a 4,5 MB y además había un tope
 * de 10 MB en código. Ahora:
 *   POST /api/chat/upload-url  { name, type, size } → { signedUrl, path }
 *   el navegador hace PUT del archivo a signedUrl
 *   POST /api/chat/upload-url  { done: path, name, type, size } → { url, … }
 */
export const dynamic = "force-dynamic";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB: tope global del proyecto Supabase (Storage → Settings); el bucket está al máximo
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

const Start = z.object({ name: z.string().min(1).max(200), type: z.string().max(120).optional().default("application/octet-stream"), size: z.number().int().min(1) });
const Done  = z.object({ done: z.string().min(1), name: z.string().min(1).max(200), type: z.string().max(120).optional().default("application/octet-stream"), size: z.number().int().min(0) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const sb = supabaseAdmin();
  const raw = await req.json().catch(() => ({}));

  if (raw && typeof raw === "object" && "done" in raw) {
    const p = Done.safeParse(raw);
    if (!p.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    if (!p.data.done.startsWith(`${userId}/`)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: signed, error } = await sb.storage.from("chat-uploads").createSignedUrl(p.data.done, SIGNED_URL_TTL_SECONDS);
    if (error || !signed) return NextResponse.json({ error: "sign_failed", message: error?.message }, { status: 500 });
    return NextResponse.json({ ok: true, url: signed.signedUrl, path: p.data.done, name: p.data.name, size: p.data.size, content_type: p.data.type });
  }

  const p = Start.safeParse(raw);
  if (!p.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  if (p.data.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file_too_large", message: `El archivo supera el máximo de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` }, { status: 413 });
  }
  const clean = p.data.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${userId}/${crypto.randomUUID()}-${clean}`;
  const { data, error } = await sb.storage.from("chat-uploads").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "sign_failed", message: error?.message }, { status: 500 });
  return NextResponse.json({ signedUrl: data.signedUrl, path: data.path, name: clean });
}
