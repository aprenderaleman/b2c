import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone } from "@/lib/phone";

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * POST /api/admin/students/create
 *
 * Crea un estudiante manualmente (sin pasar por el funnel/lead → conversión).
 * Útil cuando un alumno se inscribe por canal externo (referido, presencial,
 * email directo) y Gelfis necesita meterlo en la plataforma a mano.
 *
 * Pasos atómicos:
 *   1. Si ya existe un user con ese email, reutilizamos su id; si no, lo
 *      creamos con role='student' y password aleatoria (el alumno usará
 *      magic-link).
 *   2. Insertamos la fila en `students` con los datos académicos.
 *
 * Auth: admin / superadmin.
 */
const Body = z.object({
  full_name:            z.string().trim().min(1).max(120),
  email:                z.string().trim().email().max(160),
  phone:                z.string().trim().min(4).max(40).nullable().optional(),
  phone_country:        z.string().trim().regex(/^\+?\d{1,4}$/).optional(),
  language_preference:  z.enum(["es","de"]).default("es"),

  current_level:        z.enum(["A0","A1","A2","B1","B2","C1","C2"]).default("A0"),
  goal:                 z.string().trim().max(200).nullable().optional(),
  subscription_type:    z.enum(["single_classes","package","monthly_subscription","combined"]).default("package"),
  classes_purchased:    z.coerce.number().int().min(0).max(500).default(96),
  classes_per_month:    z.coerce.number().int().min(1).max(50).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const sb = supabaseAdmin();

  // Phone normalisation
  let phone: string | null = null;
  if (b.phone) {
    const cc = (b.phone_country?.replace("+","") ?? "49");
    try { phone = normalizePhone(b.phone, cc); }
    catch (e) { return NextResponse.json({ error: "phone_invalid", message: e instanceof Error ? e.message : "invalid" }, { status: 400 }); }
  }

  // Reuse existing user by email or create new
  const emailLower = b.email.toLowerCase();
  let userId: string | null = null;
  const { data: existing } = await sb
    .from("users")
    .select("id, role")
    .eq("email", emailLower)
    .maybeSingle();

  if (existing) {
    userId = (existing as { id: string }).id;
    // Si era teacher/admin, no convertimos (decisión consciente).
    if ((existing as { role: string }).role !== "student") {
      return NextResponse.json({
        error: "email_used_by_other_role",
        reason: `email ya pertenece a un usuario con role='${(existing as { role: string }).role}'`,
      }, { status: 409 });
    }
    // ¿ya tenía students row?
    const { data: stuExists } = await sb.from("students").select("id").eq("user_id", userId).maybeSingle();
    if (stuExists) {
      return NextResponse.json({
        error: "student_already_exists",
        student_id: (stuExists as { id: string }).id,
      }, { status: 409 });
    }
  } else {
    // Crear user con password temporal (must_change_password=true).
    // El alumno usa el flujo de "olvidé mi contraseña" para establecer
    // la suya cuando entra por primera vez. Lo mismo hace approve-teacher.
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const { data: newUser, error: ue } = await sb
      .from("users")
      .insert({
        email:                 emailLower,
        full_name:             b.full_name,
        phone,
        role:                  "student",
        language_preference:   b.language_preference,
        active:                true,
        password_hash:         passwordHash,
        must_change_password:  true,
      })
      .select("id")
      .single();
    if (ue || !newUser) return NextResponse.json({ error: "user_create_failed", message: ue?.message }, { status: 500 });
    userId = (newUser as { id: string }).id;
  }

  // Crear students row
  const { data: newStu, error: se } = await sb
    .from("students")
    .insert({
      user_id:             userId,
      current_level:       b.current_level,
      goal:                b.goal ?? null,
      subscription_type:   b.subscription_type,
      subscription_status: "active",
      classes_purchased:   b.classes_purchased,
      classes_per_month:   b.classes_per_month ?? null,
    })
    .select("id")
    .single();
  if (se || !newStu) return NextResponse.json({ error: "student_create_failed", message: se?.message }, { status: 500 });

  return NextResponse.json({ ok: true, student_id: (newStu as { id: string }).id, user_id: userId, reused_user: Boolean(existing) });
}
