import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/teachers/[id]
 *
 * Today only used for the trial-rotation toggle, but the schema is
 * extensible to other fields without much fuss. Admin-only.
 */
export const runtime = "nodejs";

const Body = z.object({
  accepts_trials: z.boolean().optional(),
  active:         z.boolean().optional(),
}).refine(b => Object.keys(b).length > 0, { message: "no_changes" });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("teachers").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
