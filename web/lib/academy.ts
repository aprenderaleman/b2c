import { supabaseAdmin } from "./supabase";

// =============================================================================
// Shared row shapes surfaced in the admin UI.
// =============================================================================

export type StudentRow = {
  id:                    string;
  user_id:               string;
  email:                 string;
  full_name:             string | null;
  phone:                 string | null;
  language_preference:   "es" | "de";
  active:                boolean;

  current_level:         string;
  goal:                  string | null;

  subscription_type:     string;
  subscription_status:   string;
  classes_remaining:     number;
  classes_per_month:     number | null;
  monthly_price_cents:   number | null;
  currency:              string;

  schule_access:         boolean;
  hans_access:           boolean;

  converted_at:          string;
  lead_id:               string | null;
  notes:                 string | null;
};

export type TeacherRow = {
  id:                    string;
  user_id:               string;
  email:                 string;
  full_name:             string | null;
  phone:                 string | null;
  language_preference:   "es" | "de";
  active:                boolean;
  bio:                   string | null;
  languages_spoken:      string[];
  specialties:           string[];
  hourly_rate:           string | null;   // numeric arrives as string from PostgREST
  currency:              string;
  payment_method:        string | null;
  notes:                 string | null;
  created_at:            string;
};

// =============================================================================
// Queries — students
// =============================================================================

export type StudentsFilter = {
  q?:                   string;                  // match on email or full_name
  status?:              string;                  // subscription_status filter
  subscription_type?:   string;
  level?:               string;
  limit?:               number;
  offset?:              number;
};

export async function getStudents(
  f: StudentsFilter = {},
): Promise<{ rows: StudentRow[]; total: number }> {
  const sb = supabaseAdmin();
  // We need columns from BOTH students and users. The Supabase JS client
  // supports the embedded-select trick: students with their linked users.
  let q = sb
    .from("students")
    .select(
      `
        id, user_id, lead_id, current_level, goal,
        subscription_type, subscription_status, classes_remaining,
        classes_per_month, monthly_price_cents, currency,
        schule_access, hans_access, notes, converted_at,
        users!inner(email, full_name, phone, language_preference, active)
      `,
      { count: "exact" },
    );

  if (f.status)            q = q.eq("subscription_status", f.status);
  if (f.subscription_type) q = q.eq("subscription_type",   f.subscription_type);
  if (f.level)             q = q.eq("current_level",       f.level);

  // For text search on joined table columns we rely on the view-style OR filter:
  //   users.email.ilike.%q% OR users.full_name.ilike.%q%
  if (f.q) {
    const safe = f.q.replace(/[%]/g, "");
    q = q.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`, { foreignTable: "users" });
  }

  q = q.order("converted_at", { ascending: false });

  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw error;

  // Flatten the embedded users object into the row shape the UI expects.
  // Supabase can return the relation as an array even for !inner, so normalise.
  const rows: StudentRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const u = r.users as (
      | { email: string; full_name: string | null; phone: string | null;
          language_preference: "es" | "de"; active: boolean; }
      | Array<{ email: string; full_name: string | null; phone: string | null;
          language_preference: "es" | "de"; active: boolean; }>
      | null
    );
    const uu = Array.isArray(u) ? u[0] : u;
    return {
      id:                  r.id as string,
      user_id:              r.user_id as string,
      email:                uu?.email ?? "",
      full_name:            uu?.full_name ?? null,
      phone:                uu?.phone ?? null,
      language_preference:  uu?.language_preference ?? "es",
      active:               uu?.active ?? true,
      current_level:        (r.current_level as string) ?? "A0",
      goal:                 (r.goal as string | null) ?? null,
      subscription_type:    r.subscription_type as string,
      subscription_status:  r.subscription_status as string,
      classes_remaining:    (r.classes_remaining as number) ?? 0,
      classes_per_month:    (r.classes_per_month as number | null) ?? null,
      monthly_price_cents:  (r.monthly_price_cents as number | null) ?? null,
      currency:             (r.currency as string) ?? "EUR",
      schule_access:        Boolean(r.schule_access),
      hans_access:          Boolean(r.hans_access),
      converted_at:         r.converted_at as string,
      lead_id:              (r.lead_id as string | null) ?? null,
      notes:                (r.notes as string | null) ?? null,
    };
  });

  return { rows, total: count ?? rows.length };
}

export async function getStudentById(id: string): Promise<StudentRow | null> {
  const { rows } = await getStudents({ q: undefined });
  const single = rows.find(r => r.id === id);
  if (single) return single;

  // Fallback: direct query (used when the student isn't in the first page).
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("students")
    .select(`
      id, user_id, lead_id, current_level, goal,
      subscription_type, subscription_status, classes_remaining,
      classes_per_month, monthly_price_cents, currency,
      schule_access, hans_access, notes, converted_at,
      users!inner(email, full_name, phone, language_preference, active)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const u = (data as { users: unknown }).users;
  const uu = (Array.isArray(u) ? u[0] : u) as
    | { email: string; full_name: string | null; phone: string | null;
        language_preference: "es" | "de"; active: boolean; }
    | undefined;
  return {
    id:                   data.id as string,
    user_id:              data.user_id as string,
    email:                uu?.email ?? "",
    full_name:            uu?.full_name ?? null,
    phone:                uu?.phone ?? null,
    language_preference:  uu?.language_preference ?? "es",
    active:               uu?.active ?? true,
    current_level:        (data.current_level as string) ?? "A0",
    goal:                 (data.goal as string | null) ?? null,
    subscription_type:    data.subscription_type as string,
    subscription_status:  data.subscription_status as string,
    classes_remaining:    (data.classes_remaining as number) ?? 0,
    classes_per_month:    (data.classes_per_month as number | null) ?? null,
    monthly_price_cents:  (data.monthly_price_cents as number | null) ?? null,
    currency:             (data.currency as string) ?? "EUR",
    schule_access:        Boolean(data.schule_access),
    hans_access:          Boolean(data.hans_access),
    converted_at:         data.converted_at as string,
    lead_id:              (data.lead_id as string | null) ?? null,
    notes:                (data.notes as string | null) ?? null,
  };
}

// =============================================================================
// Queries — teachers
// =============================================================================

export async function getTeachers(): Promise<TeacherRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teachers")
    .select(`
      id, user_id, bio, languages_spoken, specialties,
      hourly_rate, currency, payment_method, notes, active, created_at,
      users!inner(email, full_name, phone, language_preference, active)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: Record<string, unknown>) => {
    const u = r.users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { email: string; full_name: string | null; phone: string | null;
          language_preference: "es" | "de"; active: boolean; }
      | undefined;
    return {
      id:                   r.id as string,
      user_id:              r.user_id as string,
      email:                uu?.email ?? "",
      full_name:            uu?.full_name ?? null,
      phone:                uu?.phone ?? null,
      language_preference:  uu?.language_preference ?? "es",
      active:               Boolean(r.active),
      bio:                  (r.bio as string | null) ?? null,
      languages_spoken:     (r.languages_spoken as string[]) ?? [],
      specialties:          (r.specialties as string[]) ?? [],
      hourly_rate:          (r.hourly_rate as string | null) ?? null,
      currency:             (r.currency as string) ?? "EUR",
      payment_method:       (r.payment_method as string | null) ?? null,
      notes:                (r.notes as string | null) ?? null,
      created_at:           r.created_at as string,
    };
  });
}

export async function getTeacherById(id: string): Promise<TeacherRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teachers")
    .select(`
      id, user_id, bio, languages_spoken, specialties,
      hourly_rate, currency, payment_method, notes, active, created_at,
      users!inner(email, full_name, phone, language_preference, active)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const u = (data as { users: unknown }).users;
  const uu = (Array.isArray(u) ? u[0] : u) as
    | { email: string; full_name: string | null; phone: string | null;
        language_preference: "es" | "de"; active: boolean; }
    | undefined;
  return {
    id:                   data.id as string,
    user_id:              data.user_id as string,
    email:                uu?.email ?? "",
    full_name:            uu?.full_name ?? null,
    phone:                uu?.phone ?? null,
    language_preference:  uu?.language_preference ?? "es",
    active:               Boolean(data.active),
    bio:                  (data.bio as string | null) ?? null,
    languages_spoken:     (data.languages_spoken as string[]) ?? [],
    specialties:          (data.specialties as string[]) ?? [],
    hourly_rate:          (data.hourly_rate as string | null) ?? null,
    currency:             (data.currency as string) ?? "EUR",
    payment_method:       (data.payment_method as string | null) ?? null,
    notes:                (data.notes as string | null) ?? null,
    created_at:           data.created_at as string,
  };
}

// =============================================================================
// Display helpers
// =============================================================================

export function moneyFromCents(cents: number | null, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "—";
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function subscriptionTypeEs(type: string): string {
  const m: Record<string, string> = {
    single_classes:       "Clases sueltas",
    package:              "Paquete",
    monthly_subscription: "Suscripción mensual",
    combined:             "Combinado",
  };
  return m[type] ?? type;
}

export function subscriptionStatusEs(status: string): string {
  const m: Record<string, string> = {
    active:    "Activa",
    paused:    "Pausada",
    cancelled: "Cancelada",
    expired:   "Expirada",
  };
  return m[status] ?? status;
}
