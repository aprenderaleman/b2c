import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/internal/students/active
 *
 * Bulk endpoint that returns the full list of active students in the
 * academy. Designed to be polled periodically by SCHULE (and any other
 * downstream system that needs to sync who has an active subscription)
 * so they can keep their own copy of "who's allowed in" without
 * touching the b2c database directly.
 *
 *   GET /api/internal/students/active
 *   Header: X-Internal-Api-Key: $B2C_INTERNAL_API_KEY
 *
 * Pagination: this returns ALL active students in one shot. The
 * cohort is small (<500 today, will grow but unlikely to exceed
 * a few thousand). When that becomes a problem we'll add cursor
 * pagination via ?after=<id>.
 *
 * Filter: status IN ('active', 'paused') AND user.active = true
 * AND (pack_expires_at IS NULL OR pack_expires_at > now()).
 * "paused" is included because Schule should still let them in to
 * see materials — billing is paused, not access.
 *
 * Response shape — kept minimal and stable. Add fields when SCHULE
 * needs them, never remove or rename without bumping the path:
 *
 *   {
 *     "ok": true,
 *     "generated_at": "2026-04-30T16:42:11.123Z",
 *     "count": 13,
 *     "students": [
 *       {
 *         "user_id":             "uuid",
 *         "email":               "lower@case.com",
 *         "full_name":           "Ayman Kayali",
 *         "subscription_status": "active",
 *         "pack_expires_at":     "2026-12-31T00:00:00Z" | null,
 *         "current_level":       "B1" | null,
 *         "language_preference": "es" | "de"
 *       }
 *     ]
 *   }
 *
 * Cache-Control: no-store. SCHULE decides its own polling cadence.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "student" | "teacher" | "admin" | "superadmin";

type WireUser = {
  user_id:               string;
  email:                 string;
  full_name:             string | null;
  role:                  Role;
  language_preference:   "es" | "de";
  // Student-only fields. null for staff / teachers.
  subscription_status:   "active" | "paused" | null;
  pack_expires_at:       string | null;
  current_level:         string | null;
  stripe_customer_id:    string | null;
  stripe_subscription_id: string | null;
};

type StudentRow = {
  user_id:                string;
  subscription_status:    string;
  pack_expires_at:        string | null;
  classes_remaining:      number | null;
  current_level:          string | null;
  stripe_customer_id:     string | null;
  stripe_subscription_id: string | null;
  users: {
    email:               string;
    full_name:           string | null;
    active:              boolean;
    role:                Role;
    language_preference: "es" | "de" | null;
  } | Array<{
    email:               string;
    full_name:           string | null;
    active:              boolean;
    role:                Role;
    language_preference: "es" | "de" | null;
  }>;
};

type StaffRow = {
  id:                  string;
  email:               string;
  full_name:           string | null;
  role:                Role;
  language_preference: "es" | "de" | null;
};

export async function GET(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const key = req.headers.get("x-internal-api-key");
  if (key !== expected) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const sb = supabaseAdmin();

  // Two queries in parallel: students (with subscription) and staff
  // (admins / superadmins / teachers — no subscription fields). Both
  // get filtered to users.active=true server-side.
  const [studentsRes, staffRes] = await Promise.all([
    sb.from("students")
      .select(`
        user_id,
        subscription_status,
        pack_expires_at,
        classes_remaining,
        current_level,
        stripe_customer_id,
        stripe_subscription_id,
        users!inner(email, full_name, active, role, language_preference)
      `)
      .in("subscription_status", ["active", "paused"]),
    sb.from("users")
      .select("id, email, full_name, role, language_preference")
      .in("role", ["admin", "superadmin", "teacher"])
      .eq("active", true),
  ]);

  if (studentsRes.error) {
    return NextResponse.json(
      { ok: false, error: "query_failed", message: studentsRes.error.message },
      { status: 500 },
    );
  }
  if (staffRes.error) {
    return NextResponse.json(
      { ok: false, error: "query_failed", message: staffRes.error.message },
      { status: 500 },
    );
  }

  const now = Date.now();

  // Map students → wire shape, filter inactive users + expired packs.
  const studentRows: WireUser[] = ((studentsRes.data ?? []) as unknown as StudentRow[])
    .map(r => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      return {
        user_id:                r.user_id,
        email:                  (u?.email ?? "").toLowerCase(),
        full_name:              u?.full_name ?? null,
        role:                   (u?.role ?? "student") as Role,
        language_preference:    (u?.language_preference ?? "es") as "es" | "de",
        subscription_status:    r.subscription_status as "active" | "paused",
        pack_expires_at:        r.pack_expires_at,
        current_level:          r.current_level,
        stripe_customer_id:     r.stripe_customer_id,
        stripe_subscription_id: r.stripe_subscription_id,
        _userActive: Boolean(u?.active),
        _classesRemaining: r.classes_remaining ?? 0,
      } as WireUser & { _userActive: boolean; _classesRemaining: number };
    })
    .filter(s => s._userActive)
    // Fecha vencida solo excluye si además no quedan clases (caso
    // Victoria 2026-08-07: pack_expires_at obsoleto con 7 clases
    // restantes la dejaba fuera del sync y sin acceso a Schule).
    .filter(s => !s.pack_expires_at
      || new Date(s.pack_expires_at).getTime() > now
      || (s as unknown as { _classesRemaining: number })._classesRemaining > 0)
    .map(({ _userActive, ...rest }) => {
      void _userActive;
      const { _classesRemaining, ...clean } = rest as WireUser & { _classesRemaining: number };
      void _classesRemaining;
      return clean;
    });

  // Map staff → wire shape. No subscription / Stripe — null on every
  // student-only field. Staff always has full SCHULE access (admin
  // panels, teacher "see what student sees" feature).
  const staffRows: WireUser[] = ((staffRes.data ?? []) as StaffRow[])
    .map(r => ({
      user_id:                r.id,
      email:                  r.email.toLowerCase(),
      full_name:              r.full_name,
      role:                   r.role,
      language_preference:    (r.language_preference ?? "es") as "es" | "de",
      subscription_status:    null,
      pack_expires_at:        null,
      current_level:          null,
      stripe_customer_id:     null,
      stripe_subscription_id: null,
    }));

  // Dedup by user_id — a teacher who's also a student wouldn't happen
  // in practice but the safety net is cheap. Students win because
  // their row carries subscription data.
  const byId = new Map<string, WireUser>();
  for (const s of staffRows)   byId.set(s.user_id, s);
  for (const s of studentRows) byId.set(s.user_id, s);
  const allRows = [...byId.values()].sort((a, b) =>
    (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)
  );

  return NextResponse.json(
    {
      ok:           true,
      generated_at: new Date().toISOString(),
      count:        allRows.length,
      // Field name kept as `students` for backwards-compat with the
      // first version of the contract; SCHULE just needs to read each
      // entry's `role` to know who's a student vs staff.
      students:     allRows,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
