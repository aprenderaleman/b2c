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
  clases_totales:        number | null;
  classes_purchased:     number | null;
  classes_per_month:     number | null;
  monthly_price_cents:   number | null;
  currency:              string;

  schule_access:         boolean;
  hans_access:           boolean;

  converted_at:          string;
  lead_id:               string | null;
  notes:                 string | null;
  document_url:          string | null;

  attendance_rate:       number | null;
  schule_completion_pct: number | null;
  garantia_status:       string;
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
  /** Whether this teacher is in the trial-class rotation pool. */
  accepts_trials:        boolean;
  created_at:            string;
  // Campos del flujo de auto-registro (migration 049). Opcionales en
  // el tipo porque getTeachers() y getTeacherByUserId() no los
  // seleccionan — solo getTeacherById() los rellena. Si en el futuro
  // alguna función los necesita, extender el SELECT correspondiente.
  address?:                 string | null;
  country?:                 string | null;
  levels_taught?:           string[];
  hourly_rate_group?:       string | null;
  hourly_rate_individual?:  string | null;
  iban?:                    string | null;
  registered_self?:         boolean;
  approved_at?:             string | null;
  user_active?:             boolean;
};

// =============================================================================
// Identity resolution — user_id → student_id / teacher_id
// =============================================================================

/**
 * Given a `users.id`, find the corresponding teacher row (or null).
 * Used by /profesor pages to gate queries by teacher identity.
 */
export async function getTeacherByUserId(userId: string): Promise<TeacherRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teachers")
    .select(`
      id, user_id, bio, languages_spoken, specialties,
      hourly_rate, currency, payment_method, notes, active, accepts_trials, created_at,
      users!inner(email, full_name, phone, language_preference, active)
    `)
    .eq("user_id", userId)
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
    accepts_trials:       Boolean(data.accepts_trials),
    created_at:           data.created_at as string,
  };
}

/**
 * Given a `users.id`, find the corresponding student row (or null).
 */
export async function getStudentByUserId(userId: string): Promise<StudentRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("students")
    .select(`
      id, user_id, lead_id, current_level, goal,
      subscription_type, subscription_status, classes_remaining, clases_totales, classes_purchased,
      classes_per_month, monthly_price_cents, currency,
      schule_access, hans_access, notes, converted_at, document_url,
      attendance_rate, schule_completion_pct, garantia_status,
      users!inner(email, full_name, phone, language_preference, active)
    `)
    .eq("user_id", userId)
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
    current_level:        (data.current_level as string) ?? "A1",
    goal:                 (data.goal as string | null) ?? null,
    subscription_type:    data.subscription_type as string,
    subscription_status:  data.subscription_status as string,
    classes_remaining:    (data.classes_remaining as number) ?? 0,
    clases_totales:       (data.clases_totales as number | null) ?? null,
    classes_purchased:    (data.classes_purchased as number | null) ?? null,
    classes_per_month:    (data.classes_per_month as number | null) ?? null,
    monthly_price_cents:  (data.monthly_price_cents as number | null) ?? null,
    currency:             (data.currency as string) ?? "EUR",
    schule_access:        Boolean(data.schule_access),
    hans_access:          Boolean(data.hans_access),
    converted_at:         data.converted_at as string,
    lead_id:              (data.lead_id as string | null) ?? null,
    notes:                (data.notes as string | null) ?? null,
    document_url:         (data.document_url as string | null) ?? null,
    attendance_rate:      (data.attendance_rate as number | null) ?? null,
    schule_completion_pct:(data.schule_completion_pct as number | null) ?? null,
    garantia_status:      (data.garantia_status as string) ?? "not_applicable",
  };
}

// =============================================================================
// Queries — students
// =============================================================================

export type StudentsFilter = {
  q?:                   string;                  // match on email or full_name
  status?:              string;                  // subscription_status filter
  subscription_type?:   string;
  level?:               string;
  // Inactivos = users.active=false (dados de baja). Por defecto los
  // escondemos del listado; ?inactivos=1 los muestra.
  include_inactive?:    boolean;
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
        subscription_type, subscription_status, classes_remaining, clases_totales, classes_purchased,
        classes_per_month, monthly_price_cents, currency,
        schule_access, hans_access, notes, converted_at, document_url,
        attendance_rate, schule_completion_pct, garantia_status,
        users!inner(email, full_name, phone, language_preference, active)
      `,
      { count: "exact" },
    );

  if (f.status)            q = q.eq("subscription_status", f.status);
  if (f.subscription_type) q = q.eq("subscription_type",   f.subscription_type);
  if (f.level)             q = q.eq("current_level",       f.level);
  // Ocultar dados de baja salvo que el admin lo pida explícitamente.
  if (!f.include_inactive) q = q.eq("users.active", true);

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
      current_level:        (r.current_level as string) ?? "A1",
      goal:                 (r.goal as string | null) ?? null,
      subscription_type:    r.subscription_type as string,
      subscription_status:  r.subscription_status as string,
      classes_remaining:    (r.classes_remaining as number) ?? 0,
      clases_totales:       (r.clases_totales as number | null) ?? null,
      classes_purchased:    (r.classes_purchased as number | null) ?? null,
      classes_per_month:    (r.classes_per_month as number | null) ?? null,
      monthly_price_cents:  (r.monthly_price_cents as number | null) ?? null,
      currency:             (r.currency as string) ?? "EUR",
      schule_access:        Boolean(r.schule_access),
      hans_access:          Boolean(r.hans_access),
      converted_at:         r.converted_at as string,
      lead_id:              (r.lead_id as string | null) ?? null,
      notes:                (r.notes as string | null) ?? null,
      document_url:         (r.document_url as string | null) ?? null,
      attendance_rate:      (r.attendance_rate as number | null) ?? null,
      schule_completion_pct:(r.schule_completion_pct as number | null) ?? null,
      garantia_status:      (r.garantia_status as string) ?? "not_applicable",
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
      subscription_type, subscription_status, classes_remaining, clases_totales, classes_purchased,
      classes_per_month, monthly_price_cents, currency,
      schule_access, hans_access, notes, converted_at, document_url,
      attendance_rate, schule_completion_pct, garantia_status,
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
    current_level:        (data.current_level as string) ?? "A1",
    goal:                 (data.goal as string | null) ?? null,
    subscription_type:    data.subscription_type as string,
    subscription_status:  data.subscription_status as string,
    classes_remaining:    (data.classes_remaining as number) ?? 0,
    clases_totales:       (data.clases_totales as number | null) ?? null,
    classes_purchased:    (data.classes_purchased as number | null) ?? null,
    classes_per_month:    (data.classes_per_month as number | null) ?? null,
    monthly_price_cents:  (data.monthly_price_cents as number | null) ?? null,
    currency:             (data.currency as string) ?? "EUR",
    schule_access:        Boolean(data.schule_access),
    hans_access:          Boolean(data.hans_access),
    converted_at:         data.converted_at as string,
    lead_id:              (data.lead_id as string | null) ?? null,
    notes:                (data.notes as string | null) ?? null,
    document_url:         (data.document_url as string | null) ?? null,
    attendance_rate:      (data.attendance_rate as number | null) ?? null,
    schule_completion_pct:(data.schule_completion_pct as number | null) ?? null,
    garantia_status:      (data.garantia_status as string) ?? "not_applicable",
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
      hourly_rate, currency, payment_method, notes, active, accepts_trials, created_at,
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
      accepts_trials:       Boolean(r.accepts_trials),
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
      hourly_rate, currency, payment_method, notes, active, accepts_trials, created_at,
      address, country, levels_taught, hourly_rate_group, hourly_rate_individual,
      iban, registered_self, approved_at,
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
    accepts_trials:       Boolean(data.accepts_trials),
    created_at:           data.created_at as string,
    address:                (data.address as string | null) ?? null,
    country:                (data.country as string | null) ?? null,
    levels_taught:          (data.levels_taught as string[]) ?? [],
    hourly_rate_group:      (data.hourly_rate_group as string | null) ?? null,
    hourly_rate_individual: (data.hourly_rate_individual as string | null) ?? null,
    iban:                   (data.iban as string | null) ?? null,
    registered_self:        Boolean(data.registered_self),
    approved_at:            (data.approved_at as string | null) ?? null,
    user_active:            Boolean(uu?.active),
  };
}

// =============================================================================
// Queries — students overview (profe + clases completadas)
// =============================================================================

export type StudentOverview = {
  completed: number;
  teacher:   string | null;
};

export async function getStudentsOverview(
  studentIds: string[],
): Promise<Record<string, StudentOverview>> {
  const out: Record<string, StudentOverview> = {};
  if (studentIds.length === 0) return out;
  for (const id of studentIds) out[id] = { completed: 0, teacher: null };
  const sb = supabaseAdmin();

  const [{ data: parts, error: e1 }, { data: members, error: e2 }] = await Promise.all([
    sb.from("class_participants")
      .select("student_id, classes!inner(status)")
      .in("student_id", studentIds)
      .eq("classes.status", "completed"),
    sb.from("student_group_members")
      .select("student_id, student_groups!inner(active, teachers!inner(users!inner(full_name)))")
      .in("student_id", studentIds)
      .eq("student_groups.active", true),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  for (const p of (parts ?? []) as Array<{ student_id: string }>) {
    out[p.student_id].completed += 1;
  }
  const first = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  for (const m of (members ?? []) as Array<{ student_id: string; student_groups: unknown }>) {
    const g = first(m.student_groups as { teachers: unknown } | { teachers: unknown }[]);
    const t = first(g?.teachers as { users: unknown } | { users: unknown }[]);
    const u = first(t?.users as { full_name: string | null } | { full_name: string | null }[]);
    if (u?.full_name && !out[m.student_id].teacher) out[m.student_id].teacher = u.full_name.split(" ")[0];
  }
  return out;
}

// =============================================================================
// Queries — estudiantes por profesor (via grupos)
// =============================================================================

export type TeacherStudent = {
  student_id:  string;
  full_name:   string | null;
  active:      boolean;   // users.active && grupo activo
};

/** Todos los estudiantes que han pasado por los grupos de cada profesor. */
export async function getTeacherStudents(): Promise<Record<string, TeacherStudent[]>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("student_group_members")
    .select("student_id, student_groups!inner(teacher_id, active), students!inner(users!inner(full_name, active))");
  if (error) throw error;

  const first = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  const out: Record<string, Map<string, TeacherStudent>> = {};
  for (const m of (data ?? []) as Array<{ student_id: string; student_groups: unknown; students: unknown }>) {
    const g = first(m.student_groups as { teacher_id: string; active: boolean } | { teacher_id: string; active: boolean }[]);
    const s = first(m.students as { users: unknown } | { users: unknown }[]);
    const u = first(s?.users as { full_name: string | null; active: boolean } | { full_name: string | null; active: boolean }[]);
    if (!g) continue;
    const bucket = (out[g.teacher_id] ??= new Map());
    const active = Boolean(u?.active) && Boolean(g.active);
    const prev = bucket.get(m.student_id);
    bucket.set(m.student_id, {
      student_id: m.student_id,
      full_name:  u?.full_name ?? null,
      active:     (prev?.active ?? false) || active,
    });
  }
  const res: Record<string, TeacherStudent[]> = {};
  for (const [tid, map] of Object.entries(out)) {
    res[tid] = [...map.values()].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  }
  return res;
}

// =============================================================================
// Display helpers
// =============================================================================

/** Ritmo: Viajero/Estándar/Intensivo/VIP Express para suscripciones, "Paquete" para packs. */
export function ritmoLabelEs(s: Pick<StudentRow, "subscription_type" | "classes_per_month" | "monthly_price_cents">): string {
  if (s.subscription_type === "monthly_subscription") {
    const byClasses: Record<number, string> = { 6: "Viajero", 8: "Estándar", 12: "Intensivo", 16: "VIP Express" };
    const byPrice:   Record<number, string> = { 240: "Viajero", 320: "Estándar", 450: "Intensivo", 690: "VIP Express" };
    return (s.classes_per_month && byClasses[s.classes_per_month])
      || (s.monthly_price_cents && byPrice[s.monthly_price_cents / 100])
      || "Suscripción";
  }
  return subscriptionTypeEs(s.subscription_type);
}

/** Meta = nivel al que llega el estudiante. */
export function goalLevelEs(goal: string | null): string {
  const m: Record<string, string> = { a1_a2: "A2", b1: "B1", b2: "B2", c1: "C1" };
  return goal ? (m[goal] ?? goal) : "—";
}

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
