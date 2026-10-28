import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStudentByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { addComment, listComments } from "@/lib/serie";

/**
 * GET  /api/estudiante/serie/[slug]/comments          → lista
 * POST /api/estudiante/serie/[slug]/comments { body } → publica (≤ 1000 chars)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ body: z.string().trim().min(1).max(1000) });

async function ctx(slug: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  const student = role === "student" ? await getStudentByUserId((session.user as { id: string }).id) : null;
  const { data: ep } = await supabaseAdmin().from("serie_episodes").select("id").eq("slug", slug).eq("published", true).maybeSingle();
  if (!ep) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  return { role, student, episodeId: (ep as { id: string }).id };
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx(slug); if ("error" in c) return c.error;
  return NextResponse.json({ comments: await listComments(c.episodeId, c.student?.id ?? null) });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await ctx(slug); if ("error" in c) return c.error;
  if (!c.student) return NextResponse.json({ error: "students_only", message: "Solo los alumnos pueden comentar." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", message: "El comentario debe tener entre 1 y 1000 caracteres." }, { status: 400 });
  const comment = await addComment(c.episodeId, c.student.id, parsed.data.body);
  return NextResponse.json({ ok: true, comment });
}
