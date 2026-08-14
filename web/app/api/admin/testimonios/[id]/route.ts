import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<NextResponse | true> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || !["admin", "superadmin"].includes(role ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return true;
}

/**
 * PATCH — toggle active o update meta_tag/transcripcion.
 * Body JSON: { active?: boolean, meta_tag?: string, transcripcion?: string }
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authRes = await requireAdmin();
  if (authRes !== true) return authRes;
  const { id } = await ctx.params;
  const body = await req.json();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.meta_tag === "string") patch.meta_tag = body.meta_tag;
  if (typeof body.transcripcion === "string" || body.transcripcion === null) patch.transcripcion = body.transcripcion;

  const sb = supabaseAdmin();
  const { error } = await sb.from("testimonials").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE — elimina el testimonial (el audio en R2 se conserva por si
 * se reasocia; borra solo la fila BD). Los envíos previos en
 * testimonial_sends se borran en cascada.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authRes = await requireAdmin();
  if (authRes !== true) return authRes;
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { error } = await sb.from("testimonials").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
