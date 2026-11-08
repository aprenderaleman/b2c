import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/student/serie/play — registro de reproducciones de la serie
 * (Gelfis 2026-11-08). El player manda:
 *   { slug, event: "play" }            al darle play
 *   { slug, event: "progress", pct }   cada ~30 s y al pausar/salir
 *
 * Una fila por estudiante+capítulo (upsert): play_count, max_pct y
 * timestamps. Profes/admins que ven la serie NO se registran (solo
 * cuentas con students row). Best-effort: nunca rompe el player.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { slug?: string; event?: string; pct?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const slug  = typeof body.slug === "string" ? body.slug.slice(0, 80) : "";
  const event = body.event === "progress" ? "progress" : "play";
  const pct   = Math.max(0, Math.min(100, Math.round(Number(body.pct) || 0)));
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: stu } = await sb
    .from("students").select("id").eq("user_id", (session.user as { id: string }).id).maybeSingle();
  if (!stu) return NextResponse.json({ ok: true, tracked: false }); // profe/admin viendo la serie

  const { data: ep } = await sb
    .from("serie_episodes").select("id").eq("slug", slug).maybeSingle();
  if (!ep) return NextResponse.json({ error: "episode_not_found" }, { status: 404 });

  const episodeId = (ep as { id: string }).id;
  const studentId = (stu as { id: string }).id;

  const { data: existing } = await sb
    .from("serie_episode_plays")
    .select("play_count, max_pct")
    .eq("episode_id", episodeId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (!existing) {
    await sb.from("serie_episode_plays").insert({
      episode_id: episodeId,
      student_id: studentId,
      max_pct: pct,
    });
  } else {
    const row = existing as { play_count: number; max_pct: number };
    await sb.from("serie_episode_plays").update({
      last_played_at: new Date().toISOString(),
      play_count: event === "play" ? row.play_count + 1 : row.play_count,
      max_pct: Math.max(row.max_pct, pct),
    }).eq("episode_id", episodeId).eq("student_id", studentId);
  }

  return NextResponse.json({ ok: true, tracked: true });
}
