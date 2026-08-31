import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase";

export type CreateUserInput = {
  email:     string;
  fullName:  string;
  phone:     string | null;
  language:  "es" | "de";
  role:      "admin" | "teacher" | "closer" | "setter";
  // Si true, el usuario se crea con active=false (necesita aprobación
  // manual del admin antes de poder loguearse). Usado por el flujo
  // de auto-registro de profesores. Por defecto false → activo de
  // inmediato (compat con el flujo admin manual).
  inactive?: boolean;
  // Teacher-only fields (ignored when role='admin')
  teacherProfile?: {
    bio:              string | null;
    languagesSpoken:  string[];
    specialties:      string[];
    hourlyRate:       number | null;
    currency:         "EUR" | "USD" | "CHF";
    paymentMethod:    string | null;
    notes:            string | null;
    // Campos nuevos del flujo de auto-registro (migration 049).
    // Opcionales en compat con el admin-manual viejo que no los pasa.
    address?:               string | null;
    country?:               string | null;
    levelsTaught?:          string[];
    hourlyRateGroup?:       number | null;
    hourlyRateIndividual?:  number | null;
    iban?:                  string | null;
    registeredSelf?:        boolean;       // true cuando viene del form público
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
      // active=false cuando se llama desde el auto-registro de profe;
      // ahí el admin debe aprobar manualmente. Default true (admin
      // manual desde /admin/usuarios/nuevo crea ya operativo).
      active:               !input.inactive,
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
        user_id:                 user.id,
        bio:                     p.bio,
        languages_spoken:        p.languagesSpoken,
        specialties:             p.specialties,
        hourly_rate:             p.hourlyRate,
        currency:                p.currency,
        payment_method:          p.paymentMethod,
        notes:                   p.notes,
        // active=false cuando hay que aprobar manualmente. Solo
        // bloquea matchmaking — el user.active es el que gatekeeping
        // del login. Marcamos los dos coherentes.
        active:                  !input.inactive,
        // Campos nuevos del flujo de auto-registro (migration 049)
        address:                 p.address               ?? null,
        country:                 p.country               ?? null,
        levels_taught:           p.levelsTaught          ?? [],
        hourly_rate_group:       p.hourlyRateGroup       ?? null,
        hourly_rate_individual:  p.hourlyRateIndividual  ?? null,
        // El sistema de payroll lee rate_*_cents (INTEGER céntimos).
        // Los campos hourly_rate_* legacy son NUMERIC en € y se
        // quedaban desincronizados. Caso real Simon 2026-05-19:
        // ganaba 0€ porque rate_individual_cents quedaba en 0 aunque
        // hubiera puesto 13€ en el form. Ahora escribimos ambos.
        rate_individual_cents:   p.hourlyRateIndividual != null
                                   ? Math.round(p.hourlyRateIndividual * 100)
                                   : null,
        rate_group_cents:        p.hourlyRateGroup != null
                                   ? Math.round(p.hourlyRateGroup * 100)
                                   : null,
        iban:                    p.iban                  ?? null,
        registered_self:         p.registeredSelf        ?? false,
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
