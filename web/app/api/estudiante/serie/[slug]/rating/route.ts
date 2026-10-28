import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStudentByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { rateEpisode } from "@/lib/serie";

/** POST /api/estudiante/serie/[slug]/rating { stars: 1..5 } */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ stars: z.number().int().min(1).max(5) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "student") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const student = await getStudentByUserId((session.user as { id: string }).id);
  if (!student) return NextResponse.json({ error: "no_student" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { slug } = await params;
  const { data: ep } = await supabaseAdmin().from("serie_episodes").select("id").eq("slug", slug).eq("published", true).maybeSingle();
  if (!ep) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await rateEpisode((ep as { id: string }).id, student.id, parsed.data.stars);
  return NextResponse.json({ ok: true });
}
