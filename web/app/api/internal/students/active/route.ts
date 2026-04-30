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

type StudentRow = {
  user_id:             string;
  subscription_status: string;
  pack_expires_at:     string | null;
  current_level:       string | null;
  users: {
    email:               string;
    full_name:           string | null;
    active:              boolean;
    language_preference: "es" | "de" | null;
  } | Array<{
    email:               string;
    full_name:           string | null;
    active:              boolean;
    language_preference: "es" | "de" | null;
  }>;
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
  const { data, error } = await sb
    .from("students")
    .select(`
      user_id,
      subscription_status,
      pack_expires_at,
      current_level,
      users!inner(email, full_name, active, language_preference)
    `)
    .in("subscription_status", ["active", "paused"]);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  const now = Date.now();
  const rows = ((data ?? []) as unknown as StudentRow[])
    .map(r => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      return {
        user_id:             r.user_id,
        email:               (u?.email ?? "").toLowerCase(),
        full_name:           u?.full_name ?? null,
        user_active:         Boolean(u?.active),
        subscription_status: r.subscription_status,
        pack_expires_at:     r.pack_expires_at,
        current_level:       r.current_level,
        language_preference: u?.language_preference ?? "es",
      };
    })
    // Drop deactivated user rows (deleted from /admin) and expired packs.
    .filter(s => s.user_active)
    .filter(s => !s.pack_expires_at || new Date(s.pack_expires_at).getTime() > now)
    .map(s => {
      // Strip the internal-only `user_active` flag from the wire shape —
      // we already used it to filter, no need to expose.
      const { user_active: _u, ...rest } = s;
      void _u;
      return rest;
    });

  return NextResponse.json(
    {
      ok:           true,
      generated_at: new Date().toISOString(),
      count:        rows.length,
      students:     rows,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
