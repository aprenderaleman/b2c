import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

export type CreateUserInput = {
  email:     string;
  fullName:  string;
  phone:     string | null;
  language:  "es" | "de";
  role:      "admin" | "teacher";
  // Teacher-only fields (ignored when role='admin')
  teacherProfile?: {
    bio:              string | null;
    languagesSpoken:  string[];
    specialties:      string[];
    hourlyRate:       number | null;
    currency:         "EUR" | "USD" | "CHF";
    paymentMethod:    string | null;
    notes:            string | null;
  };
};

export type CreatedUser = {
  userId:       string;
  teacherId:    string | null;
  tempPassword: string;
};

/**
 * Create a user with role admin or teacher. For teachers we also insert
 * a `teachers` row with the economic profile. Returns the plaintext
 * temp password so the caller can email it.
 */
export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  const sb = supabaseAdmin();
  const email = input.email.trim().toLowerCase();
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const { data: user, error: uErr } = await sb
    .from("users")
    .insert({
      email,
      password_hash:        passwordHash,
      role:                 input.role,
      full_name:            input.fullName.trim(),
      phone:                input.phone,
      language_preference:  input.language,
      must_change_password: true,
      active:               true,
    })
    .select("id")
    .single();

  if (uErr || !user) {
    throw new Error(`user insert failed: ${uErr?.message ?? "unknown"}`);
  }

  let teacherId: string | null = null;
  if (input.role === "teacher") {
    const p = input.teacherProfile ?? {
      bio: null, languagesSpoken: ["de"], specialties: [],
      hourlyRate: null, currency: "EUR", paymentMethod: null, notes: null,
    };
    const { data: teacher, error: tErr } = await sb
      .from("teachers")
      .insert({
        user_id:           user.id,
        bio:               p.bio,
        languages_spoken:  p.languagesSpoken,
        specialties:       p.specialties,
        hourly_rate:       p.hourlyRate,
        currency:          p.currency,
        payment_method:    p.paymentMethod,
        notes:             p.notes,
        active:            true,
      })
      .select("id")
      .single();

    if (tErr || !teacher) {
      await sb.from("users").delete().eq("id", user.id);
      throw new Error(`teacher insert failed: ${tErr?.message ?? "unknown"}`);
    }
    teacherId = teacher.id as string;
  }

  return {
    userId:       user.id as string,
    teacherId,
    tempPassword,
  };
}

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
