import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/student/reviews
 *
 * Body: { class_id, rating?, comment?, dismissed? }
 *   - rating 1..5 + comment opcional → reseña real
 *   - dismissed=true (sin rating)     → el alumno cerró el popup
 *
 * Idempotente vía UNIQUE(class_id, student_id) — on conflict
 * actualizamos (el alumno puede cambiar de opinión en la misma
 * sesión si no recarga).
 *
 * Auth: el alumno solo puede reseñar SUS propias clases (verificado
 * contra class_participants).
 */
const Body = z.object({
  class_id:  z.string().uuid(),
  rating:    z.number().int().min(1).max(5).optional(),
  comment:   z.string().trim().max(2000).optional(),
  dismissed: z.boolean().optional(),
}).refine(
  d => d.dismissed === true || (typeof d.rating === "number"),
  { message: "Debes enviar rating o dismissed:true" },
);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const sb = supabaseAdmin();

  // Resolve student.id from session user
  const { data: stu } = await sb
    .from("students")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!stu) return NextResponse.json({ error: "not_a_student" }, { status: 403 });
  const studentId = (stu as { id: string }).id;

  // Ownership check: el alumno debe estar en class_participants
  const { data: part } = await sb
    .from("class_participants")
    .select("class_id")
    .eq("class_id", b.class_id)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!part) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

  const row = {
    class_id:     b.class_id,
    student_id:   studentId,
    rating:       b.dismissed ? null : (b.rating ?? null),
    comment:      b.dismissed ? null : (b.comment ?? null),
    dismissed_at: b.dismissed ? new Date().toISOString() : null,
  };

  const { error } = await sb
    .from("class_reviews")
    .upsert(row, { onConflict: "class_id,student_id" });
  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
