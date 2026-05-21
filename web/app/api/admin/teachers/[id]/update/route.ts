import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

/**
 * POST /api/admin/teachers/[id]/update
 *
 * Editor manual de un profesor (post-aprobación). Actualiza tanto la
 * fila en `users` (datos de contacto + idioma) como en `teachers`
 * (perfil académico + finanzas + interno).
 *
 * `accepts_trials` y los campos de auditoría (approved_at/by,
 * registered_self) NO son editables desde aquí.
 *
 * Auth: admin / superadmin.
 */
const Body = z.object({
  // En users
  full_name:            z.string().trim().min(1).max(120).optional(),
  email:                z.string().trim().toLowerCase().email().max(160).optional(),
  phone:                z.string().trim().min(4).max(40).nullable().optional(),
  phone_country:        z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language_preference:  z.enum(["es","de"]).optional(),
  active:               z.boolean().optional(),
  notifications_opt_out: z.boolean().optional(),

  // En teachers — perfil
  bio:                  z.string().trim().max(2000).nullable().optional(),
  languages_spoken:     z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  specialties:          z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  levels_taught:        z.array(z.enum(["A0","A1","A2","B1","B2","C1","C2"])).max(7).optional(),
  country:              z.string().trim().max(80).nullable().optional(),
  address:              z.string().trim().max(300).nullable().optional(),

  // Finanzas (en €/h; backfilleamos rate_*_cents automáticamente)
  hourly_rate_individual: z.coerce.number().min(0).max(500).nullable().optional(),
  hourly_rate_group:      z.coerce.number().min(0).max(500).nullable().optional(),
  currency:               z.enum(["EUR","USD","CHF"]).optional(),
  iban:                   z.string().trim().max(40).nullable().optional(),
  payment_method:         z.string().trim().max(80).nullable().optional(),

  // Interno
  notes:                z.string().trim().max(2000).nullable().optional(),
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

  // Pull current values for diff + user_id resolution
  const { data: cur, error: getErr } = await sb
    .from("teachers")
    .select(`
      id, user_id,
      bio, languages_spoken, specialties, levels_taught, country, address,
      hourly_rate_individual, hourly_rate_group, currency, iban, payment_method, notes,
      users!inner(full_name, email, phone, language_preference, active, notifications_opt_out)
    `)
    .eq("id", id)
    .maybeSingle();
  if (getErr || !cur) {
    return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
  }
  type U = { full_name: string | null; email: string; phone: string | null; language_preference: "es"|"de"; active: boolean; notifications_opt_out: boolean | null };
  const usersField = (cur as unknown as { users: U | U[] }).users;
  const u: U = Array.isArray(usersField) ? usersField[0] : usersField;
  const c = cur as unknown as {
    user_id: string;
    bio: string | null; languages_spoken: string[] | null; specialties: string[] | null;
    levels_taught: string[] | null; country: string | null; address: string | null;
    hourly_rate_individual: string | number | null; hourly_rate_group: string | number | null;
    currency: string | null; iban: string | null;
    payment_method: string | null; notes: string | null;
  };

  // Email collision check
  if (b.email && b.email !== u.email) {
    const { data: collision } = await sb
      .from("users")
      .select("id")
      .eq("email", b.email)
      .neq("id", c.user_id)
      .maybeSingle();
    if (collision) {
      return NextResponse.json({ error: "email_in_use" }, { status: 409 });
    }
  }

  // Phone normalisation
  let normalisedPhone: string | null | undefined = b.phone;
  if (b.phone !== undefined && b.phone !== null) {
    const cc = (b.phone_country?.replace("+","") ?? "49");
    try { normalisedPhone = normalizePhone(b.phone, cc); }
    catch (e) {
      return NextResponse.json({ error: "phone_invalid", message: e instanceof Error ? e.message : "invalid" }, { status: 400 });
    }
  }

  const userPatch:    Record<string, unknown> = {};
  const teacherPatch: Record<string, unknown> = {};
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  const setIf = (where: "user"|"teacher", key: string, oldV: unknown, newV: unknown) => {
    if (newV === undefined) return;
    if (newV === oldV) return;
    (where === "user" ? userPatch : teacherPatch)[key] = newV;
    diff[key] = { from: oldV, to: newV };
  };

  setIf("user", "full_name",             u.full_name,             b.full_name);
  setIf("user", "email",                 u.email,                 b.email);
  setIf("user", "phone",                 u.phone,                 normalisedPhone);
  setIf("user", "language_preference",   u.language_preference,   b.language_preference);
  setIf("user", "active",                u.active,                b.active);
  setIf("user", "notifications_opt_out", u.notifications_opt_out, b.notifications_opt_out);

  setIf("teacher", "bio",              c.bio,              b.bio);
  setIf("teacher", "languages_spoken", c.languages_spoken, b.languages_spoken);
  setIf("teacher", "specialties",      c.specialties,      b.specialties);
  setIf("teacher", "levels_taught",    c.levels_taught,    b.levels_taught);
  setIf("teacher", "country",          c.country,          b.country);
  setIf("teacher", "address",          c.address,          b.address);
  setIf("teacher", "currency",         c.currency,         b.currency);
  setIf("teacher", "iban",             c.iban,             b.iban);
  setIf("teacher", "payment_method",   c.payment_method,   b.payment_method);
  setIf("teacher", "notes",            c.notes,            b.notes);

  // Rates: si cambian, escribimos AMBOS sets de columnas (hourly_rate_*
  // legacy + rate_*_cents que usa el payroll). El cambio NO afecta
  // class_hours_log ya escritos — solo futuros.
  if (b.hourly_rate_individual !== undefined && Number(c.hourly_rate_individual) !== b.hourly_rate_individual) {
    teacherPatch.hourly_rate            = b.hourly_rate_individual;
    teacherPatch.hourly_rate_individual = b.hourly_rate_individual;
    teacherPatch.rate_individual_cents  = b.hourly_rate_individual === null ? 0 : Math.round(b.hourly_rate_individual * 100);
    diff.hourly_rate_individual = { from: c.hourly_rate_individual, to: b.hourly_rate_individual };
  }
  if (b.hourly_rate_group !== undefined && Number(c.hourly_rate_group) !== b.hourly_rate_group) {
    teacherPatch.hourly_rate_group = b.hourly_rate_group;
    teacherPatch.rate_group_cents  = b.hourly_rate_group === null ? 0 : Math.round(b.hourly_rate_group * 100);
    diff.hourly_rate_group = { from: c.hourly_rate_group, to: b.hourly_rate_group };
  }

  if (Object.keys(userPatch).length === 0 && Object.keys(teacherPatch).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  if (Object.keys(userPatch).length > 0) {
    const { error: ue } = await sb.from("users").update(userPatch).eq("id", c.user_id);
    if (ue) return NextResponse.json({ error: "users_update_failed", message: ue.message }, { status: 500 });
  }
  if (Object.keys(teacherPatch).length > 0) {
    const { error: te } = await sb.from("teachers").update(teacherPatch).eq("id", id);
    if (te) return NextResponse.json({ error: "teachers_update_failed", message: te.message }, { status: 500 });
  }

  // Audit (best-effort, no rompe la respuesta si falla)
  await sb.from("admin_notes").insert({
    target_type: "teacher",
    target_id:   id,
    author_id:   (session.user as { id?: string }).id ?? null,
    body:        `Edición manual:\n${Object.entries(diff).map(([k,v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`).join("\n")}`,
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, changed: true, diff });
}
