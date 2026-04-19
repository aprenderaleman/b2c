import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/admin/groups/{id}  → update group fields.
 * DELETE /api/admin/groups/{id} → soft-delete (active=false).
 * Admin-only.
 */
export const runtime = "nodejs";

const Body = z.object({
  name:         z.string().trim().min(2).max(200).optional(),
  class_type:   z.enum(["group", "individual"]).optional(),
  level:        z.enum(["A0","A1","A2","B1","B2","C1","C2"]).nullable().optional(),
  teacher_id:   z.string().uuid().nullable().optional(),
  meet_link:    z.string().url().nullable().optional().or(z.literal("")),
  document_url: z.string().url().nullable().optional().or(z.literal("")),
  capacity:     z.coerce.number().int().min(1).max(50).optional(),
  notes:        z.string().trim().max(2000).nullable().optional(),
  active:       z.boolean().optional(),
}).refine(b => Object.keys(b).length > 0, { message: "no_changes" });

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { err: null };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Normalise empty strings to null for URL fields
  const update: Record<string, unknown> = { ...b };
  if (update.meet_link    === "") update.meet_link    = null;
  if (update.document_url === "") update.document_url = null;

  const sb = supabaseAdmin();
  const { error } = await sb.from("student_groups").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin();
  if (err) return err;
  const { id } = await params;

  const sb = supabaseAdmin();
  const { error } = await sb.from("student_groups").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
