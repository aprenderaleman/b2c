import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/admin/students/[id]/update
 *
 * Editor manual de un estudiante. Actualiza tanto la fila en `users`
 * (datos de contacto + idioma) como en `students` (perfil académico).
 *
 * Pack (purchased / adjustment) tiene endpoints dedicados (edit-pack,
 * adjust-classes) — este endpoint NO los toca.
 *
 * Auth: admin / superadmin.
 */
const Body = z.object({
  // En users
  full_name:           z.string().trim().min(1).max(120).optional(),
  email:               z.string().trim().email().max(160).optional(),
  phone:               z.string().trim().min(4).max(40).nullable().optional(),
  phone_country:       z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language_preference: z.enum(["es","de"]).optional(),

  // En students
  current_level:       z.enum(["A0","A1","A2","B1","B2","C1","C2"]).optional(),
  goal:                z.string().trim().max(200).nullable().optional(),
  subscription_type:   z.enum(["single_classes","package","monthly_subscription","combined"]).optional(),
  subscription_status: z.enum(["active","paused","cancelled","expired"]).optional(),
  schule_access:       z.boolean().optional(),
  hans_access:         z.boolean().optional(),
  active:              z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const sb = supabaseAdmin();

  // Pull current to find user_id + diff
  const { data: cur, error: getErr } = await sb
    .from("students")
    .select(`
      id, user_id, current_level, goal, subscription_type, subscription_status,
      schule_access, hans_access, active,
      users!inner(full_name, email, phone, language_preference)
    `)
    .eq("id", id)
    .maybeSingle();
  if (getErr || !cur) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }
  type U = { full_name: string | null; email: string; phone: string | null; language_preference: "es"|"de" };
  const usersField = (cur as unknown as { users: U | U[] }).users;
  const u: U = Array.isArray(usersField) ? usersField[0] : usersField;

  // Normalise phone server-side if provided
  let normalisedPhone: string | null | undefined = b.phone;
  if (b.phone !== undefined && b.phone !== null) {
    const cc = (b.phone_country?.replace("+","") ?? "49");
    try { normalisedPhone = normalizePhone(b.phone, cc); }
    catch (e) {
      return NextResponse.json({ error: "phone_invalid", message: e instanceof Error ? e.message : "invalid" }, { status: 400 });
    }
  }

  const userPatch: Record<string, unknown> = {};
  const studentPatch: Record<string, unknown> = {};
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  const setIf = (where: "user"|"student", key: string, oldV: unknown, newV: unknown) => {
    if (newV === undefined) return;
    if (newV === oldV) return;
    (where === "user" ? userPatch : studentPatch)[key] = newV;
    diff[key] = { from: oldV, to: newV };
  };

  setIf("user", "full_name",           u.full_name,           b.full_name);
  setIf("user", "email",               u.email,               b.email);
  setIf("user", "phone",               u.phone,               normalisedPhone);
  setIf("user", "language_preference", u.language_preference, b.language_preference);

  const c = cur as { current_level: string; goal: string|null; subscription_type: string; subscription_status: string; schule_access: boolean; hans_access: boolean; active: boolean };
  setIf("student", "current_level",       c.current_level,       b.current_level);
  setIf("student", "goal",                c.goal,                b.goal);
  setIf("student", "subscription_type",   c.subscription_type,   b.subscription_type);
  setIf("student", "subscription_status", c.subscription_status, b.subscription_status);
  setIf("student", "schule_access",       c.schule_access,       b.schule_access);
  setIf("student", "hans_access",         c.hans_access,         b.hans_access);
  setIf("student", "active",              c.active,              b.active);

  if (Object.keys(userPatch).length === 0 && Object.keys(studentPatch).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  if (Object.keys(userPatch).length > 0) {
    const { error: ue } = await sb.from("users").update(userPatch).eq("id", (cur as { user_id: string }).user_id);
    if (ue) return NextResponse.json({ error: "users_update_failed", message: ue.message }, { status: 500 });
  }
  if (Object.keys(studentPatch).length > 0) {
    const { error: se } = await sb.from("students").update(studentPatch).eq("id", id);
    if (se) return NextResponse.json({ error: "students_update_failed", message: se.message }, { status: 500 });
  }

  // Audit (admin_notes, no lead_timeline para students)
  await sb.from("admin_notes").insert({
    target_type: "student",
    target_id:   id,
    author_id:   (session.user as { id?: string }).id ?? null,
    body:        `Edición manual:\n${Object.entries(diff).map(([k,v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`).join("\n")}`,
  }).then(() => {}, () => {});  // best-effort

  return NextResponse.json({ ok: true, changed: true, diff });
}
