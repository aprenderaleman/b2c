import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

export type CefrLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type SubscriptionType =
  | "single_classes" | "package" | "monthly_subscription" | "combined";

export type SubscriptionStatus = "active" | "paused" | "cancelled" | "expired";

export type CreateStudentInput = {
  // Identity
  email:     string;
  fullName:  string;
  phone:     string | null;
  language:  "es" | "de";

  // Link back to the lead being converted (optional — a student can also
  // be created from scratch without an originating lead).
  leadId:    string | null;

  // Academic
  currentLevel: CefrLevel;
  goal:         string | null;

  // Plan
  subscriptionType:    SubscriptionType;
  classesRemaining:    number;       // 0 for monthly_subscription until first cycle
  classesPerMonth:     number | null;
  monthlyPriceCents:   number | null;
  currency:            "EUR" | "USD" | "CHF";
};

export type CreatedStudent = {
  userId:       string;
  studentId:    string;
  tempPassword: string;
};

/**
 * Creates a `users` row with role='student' + a linked `students` row
 * in a best-effort 2-step transaction (Supabase JS doesn't expose real
 * transactions; if the second insert fails we delete the first to
 * keep things consistent).
 *
 * Returns the plaintext temporary password so the caller can include
 * it in the welcome email. That's the ONLY time the password is
 * retrievable — after this it only exists hashed.
 */
export async function createStudent(
  input: CreateStudentInput,
): Promise<CreatedStudent> {
  const sb = supabaseAdmin();

  const email = input.email.trim().toLowerCase();
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  // Step 1: create the user
  const { data: user, error: userErr } = await sb
    .from("users")
    .insert({
      email,
      password_hash:        passwordHash,
      role:                 "student",
      full_name:            input.fullName.trim(),
      phone:                input.phone,
      language_preference:  input.language,
      must_change_password: true,
      active:               true,
    })
    .select("id")
    .single();

  if (userErr || !user) {
    throw new Error(`user insert failed: ${userErr?.message ?? "unknown"}`);
  }

  // Step 2: create the student row
  const { data: student, error: studentErr } = await sb
    .from("students")
    .insert({
      user_id:             user.id,
      lead_id:             input.leadId,
      current_level:       input.currentLevel,
      goal:                input.goal,
      subscription_type:   input.subscriptionType,
      subscription_status: "active",
      classes_remaining:   input.classesRemaining,
      classes_per_month:   input.classesPerMonth,
      monthly_price_cents: input.monthlyPriceCents,
      currency:            input.currency,
      schule_access:       true,
      hans_access:         true,
    })
    .select("id")
    .single();

  if (studentErr || !student) {
    // Rollback: delete the user we just created so the email stays free.
    await sb.from("users").delete().eq("id", user.id);
    throw new Error(`student insert failed: ${studentErr?.message ?? "unknown"}`);
  }

  // Step 3 (non-blocking): patch the originating lead to point back here.
  if (input.leadId) {
    await sb.from("leads")
      .update({ converted_to_user_id: user.id })
      .eq("id", input.leadId);
  }

  return {
    userId:       user.id as string,
    studentId:    student.id as string,
    tempPassword,
  };
}

/**
 * Generate a 12-char alphanumeric temporary password. Omits visually
 * ambiguous characters (0, O, 1, l, I) so the student can type it
 * from the email without confusion.
 */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Human label for a subscription type, rendered in the welcome email
 * and on the admin list. Matches the student's language preference.
 */
export function subscriptionTypeLabel(
  type: SubscriptionType,
  lang: "es" | "de",
): string {
  const map = {
    es: {
      single_classes:        "Clases sueltas",
      package:               "Paquete de clases",
      monthly_subscription:  "Suscripción mensual",
      combined:              "Paquete combinado",
    },
    de: {
      single_classes:        "Einzelstunden",
      package:               "Unterrichtspaket",
      monthly_subscription:  "Monatsabo",
      combined:              "Kombi-Paket",
    },
  } as const;
  return map[lang][type];
}

/**
 * One-line "details" string for the welcome email.
 */
export function subscriptionDetails(
  input: {
    subscriptionType:  SubscriptionType;
    classesRemaining:  number;
    classesPerMonth:   number | null;
    monthlyPriceCents: number | null;
    currency:          "EUR" | "USD" | "CHF";
  },
  lang: "es" | "de",
): string {
  const money = (cents: number) => `${(cents / 100).toFixed(2)} ${input.currency}`;
  if (lang === "de") {
    switch (input.subscriptionType) {
      case "single_classes":
        return `${input.classesRemaining} Einzelstunde(n)`;
      case "package":
        return `${input.classesRemaining} Stunden im Paket`;
      case "monthly_subscription":
        return `${input.classesPerMonth ?? "?"} Stunden/Monat` +
               (input.monthlyPriceCents ? ` · ${money(input.monthlyPriceCents)}/Monat` : "");
      case "combined":
        return `${input.classesRemaining} Stunden + Abo`;
    }
  }
  switch (input.subscriptionType) {
    case "single_classes":
      return `${input.classesRemaining} clase(s) suelta(s)`;
    case "package":
      return `${input.classesRemaining} clases en paquete`;
    case "monthly_subscription":
      return `${input.classesPerMonth ?? "?"} clases/mes` +
             (input.monthlyPriceCents ? ` · ${money(input.monthlyPriceCents)}/mes` : "");
    case "combined":
      return `${input.classesRemaining} clases + suscripción`;
  }
}
