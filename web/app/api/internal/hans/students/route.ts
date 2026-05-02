import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/internal/hans/students
 *
 * Endpoint diseñado para "Hans" — la app paralela de tutor IA en
 * github.com/aprenderaleman/hans. Hans poolea esto cada ~6h y
 * reconcilia su tabla local de usuarios "Pro" con quien sea
 * alumno pagante de la academia.
 *
 *   GET /api/internal/hans/students
 *   Header: Authorization: Bearer <APREND_HANS_API_KEY>
 *
 * Decisiones de contrato:
 *
 *   - Token bearer separado del que usa SCHULE
 *     (`B2C_INTERNAL_API_KEY`). Hans tiene su propia clave
 *     `APREND_HANS_API_KEY` para que rotar una no afecte a la otra.
 *   - Shape distinto al endpoint de SCHULE (`/api/internal/students/active`)
 *     porque Hans pidió flatness + camelCase. No reusamos por
 *     pereza — son consumidores con contratos distintos y mezclarlos
 *     hace inevitable un breaking-change futuro.
 *   - Status mapping:
 *       subscription_status='active' → "active"
 *       subscription_status='paused' → "suspended"
 *       (cancelled / expired NO entran)
 *   - cefrLevel: pasamos A1..C2 tal cual; A0 (nuestro "no testado
 *     aún") va como null porque Hans documenta A1-C2.
 *   - nativeLanguage: usamos `language_preference` (es|de). Es lo más
 *     cercano que tenemos — no guardamos lengua materna real. Si Hans
 *     necesita más granularidad lo añadimos cuando exista la columna.
 *   - id: `users.id` (uuid). Estable forever — Hans puede usarlo de PK.
 *   - email: lowercase ya está garantizado por CHECK constraint en
 *     `users.email`, pero hacemos el .toLowerCase() defensivo.
 *
 * Response: array plano (no envoltura `{ok, students}`) — Hans pidió
 * exactamente esa forma.
 *
 * Cache-Control: no-store. Hans decide su cadencia (cada 6h).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HansStudent = {
  id:             string;
  email:          string;
  fullName:       string | null;
  cefrLevel:      "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null;
  status:         "active" | "suspended";
  nativeLanguage: "es" | "de" | null;
};

type StudentRow = {
  user_id:             string;
  subscription_status: string;
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

function checkAuth(req: NextRequest): { ok: true } | { ok: false; status: number; body: unknown } {
  const expected = process.env.APREND_HANS_API_KEY;
  if (!expected) {
    return { ok: false, status: 503, body: { error: "not_configured" } };
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const match      = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== expected) {
    return { ok: false, status: 403, body: { error: "forbidden" } };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const sb = supabaseAdmin();

  // Solo "active" — Hans pidió "alumnos con suscripción ACTIVA, no
  // leads ni cancelados". Paused se mapea a "suspended" en el output
  // por si en el futuro lo incluimos; hoy lo dejamos fuera.
  const { data, error } = await sb
    .from("students")
    .select(`
      user_id,
      subscription_status,
      current_level,
      users!inner(email, full_name, active, language_preference)
    `)
    .in("subscription_status", ["active"]);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  const allowedLevels = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

  const out: HansStudent[] = ((data ?? []) as unknown as StudentRow[])
    .map(r => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      if (!u || !u.active) return null;

      const level = (r.current_level ?? "").toUpperCase();
      const cefrLevel = allowedLevels.has(level)
        ? (level as HansStudent["cefrLevel"])
        : null;

      const status: HansStudent["status"] =
        r.subscription_status === "paused" ? "suspended" : "active";

      const nativeLanguage: HansStudent["nativeLanguage"] =
        u.language_preference === "es" || u.language_preference === "de"
          ? u.language_preference
          : null;

      return {
        id:             r.user_id,
        email:          (u.email ?? "").toLowerCase(),
        fullName:       u.full_name ?? null,
        cefrLevel,
        status,
        nativeLanguage,
      } satisfies HansStudent;
    })
    .filter((x): x is HansStudent => x !== null)
    .sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email));

  return NextResponse.json(out, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
