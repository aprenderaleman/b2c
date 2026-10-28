import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { signUploadUrl } from "@/lib/r2";

/**
 * POST /api/admin/serie/upload-url { slug, kind: "video"|"poster", contentType }
 * → { uploadUrl, fileUrl }. El navegador hace PUT del archivo a uploadUrl
 * (directo a R2) y luego confirma con PATCH /api/admin/serie/[slug].
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Misma regla que /api/admin/wa-test: CRON_SECRET (ops desde fuera) o sesión admin/superadmin. */
async function authorised(req: Request): Promise<boolean> {
  const expected = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (expected && bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  if (expected && req.headers.get("x-cron-secret") === expected) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  kind: z.enum(["video", "poster"]),
  contentType: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { slug, kind } = parsed.data;
  const { data: ep } = await supabaseAdmin().from("serie_episodes").select("id, season").eq("slug", slug).maybeSingle();
  if (!ep) return NextResponse.json({ error: "episode_not_found" }, { status: 404 });
  const season = (ep as { season: number }).season ?? 1;
  const key = `serie/t${season}/${slug}.${kind === "video" ? "mp4" : "jpg"}`;
  const contentType = kind === "video" ? "video/mp4" : "image/jpeg";
  const r = await signUploadUrl(key, contentType, 3600);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.error === "r2_not_configured" ? "R2 no está configurado en este entorno (faltan R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)." : r.error }, { status: 500 });
  return NextResponse.json({ uploadUrl: r.uploadUrl, fileUrl: r.fileUrl, key, contentType });
}
