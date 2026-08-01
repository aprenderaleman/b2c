import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_RANKS = ["starter", "pro", "elite", "master"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole(["superadmin", "admin"]);

  const { id: teacherId } = await params;

  let body: { rango?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  if (!body.rango || !VALID_RANKS.includes(body.rango)) {
    return NextResponse.json({ error: "invalid_rank", valid: VALID_RANKS }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher) {
    return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
  }

  const { error } = await sb
    .from("users")
    .update({ rango: body.rango })
    .eq("id", (teacher as { user_id: string }).user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rango: body.rango });
}
