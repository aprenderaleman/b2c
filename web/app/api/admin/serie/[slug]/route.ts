import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/serie/[slug] { video_url?, poster_url?, published? }
 * Confirma la subida (guarda las URLs con el formato de recordings.file_url)
 * o publica/oculta el episodio.
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
  video_url:  z.string().url().regex(/\.r2\.cloudflarestorage\.com\//).optional(),
  poster_url: z.string().url().regex(/\.r2\.cloudflarestorage\.com\//).optional(),
  published:  z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("serie_episodes").update(patch).eq("slug", slug).select("id, slug, video_url, poster_url, published").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "episode_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, episode: data });
}
