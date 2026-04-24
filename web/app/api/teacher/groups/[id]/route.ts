import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PATCH /api/teacher/groups/[id]
 *
 * Teacher-scoped group edit. Mirrors the admin endpoint but:
 *   - teacher can only edit groups where teacher_id === their own id
 *   - teacher_id is FORCED off the body (can't re-assign ownership)
 *   - active flag is not editable by teacher (admin-only soft delete)
 *
 * Honors admin impersonation so "view as <teacher>" still works end-to-end.
 */
export const runtime = "nodejs";

const CEFR = z.enum(["A0","A1","A2","B1","B2","C1","C2"]);

const Body = z.object({
  name:         z.string().trim().min(2).max(200).optional(),
  levels:       z.array(CEFR).max(7).optional(),
  capacity:     z.coerce.number().int().min(1).max(50).optional(),
  meet_link:    z.string().url().nullable().optional().or(z.literal("")),
  document_url: z.string().url().nullable().optional().or(z.literal("")),
  notes:        z.string().trim().max(2000).nullable().optional(),
}).refine(b => Object.keys(b).length > 0, { message: "no_changes" });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   role as "teacher" | "admin" | "superadmin",
    expectRole:     "teacher",
  });
  const me = await getTeacherByUserId(eff.userId);
  if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });

  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Ownership gate — teacher can only touch their own groups.
  const { data: g } = await sb
    .from("student_groups")
    .select("id, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!g) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if ((g as { teacher_id: string | null }).teacher_id !== me.id) {
    return NextResponse.json({ error: "not_your_group" }, { status: 403 });
  }

  const b = parsed.data;
  const update: Record<string, unknown> = { ...b };
  if (update.meet_link    === "") update.meet_link    = null;
  if (update.document_url === "") update.document_url = null;
  if (Array.isArray(b.levels)) update.level = b.levels[0] ?? null;

  const { error } = await sb.from("student_groups").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
