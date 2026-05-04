import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/internal/hans/teachers
 *
 * Mirror del endpoint `/api/internal/hans/students` pero para profesores
 * activos. Hans (github.com/aprenderaleman/hans) lo poolea para
 * reconocer a los profesores que se loguean con magic-link y darles el
 * plan Pro automático de la academia.
 *
 *   GET /api/internal/hans/teachers
 *   Header: Authorization: Bearer <APREND_HANS_API_KEY>
 *
 * Misma key que el endpoint de students (decisión: una sola rotación
 * cubre las dos integraciones; Hans es un único consumidor).
 *
 * Filtro: users.role='teacher' AND users.active=true. No miramos la
 * tabla `teachers` (donde están los datos del perfil — bio, idiomas,
 * etc.) porque Hans solo necesita identificar al usuario por email.
 *
 * Shape:
 *   [
 *     {
 *       "id":             "<uuid stable>",
 *       "email":          "lower@case.com",
 *       "fullName":       "Sabine Müller" | null,
 *       "status":         "active",
 *       "nativeLanguage": "es" | "de" | null
 *     }
 *   ]
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HansTeacher = {
  id:             string;
  email:          string;
  fullName:       string | null;
  status:         "active";
  nativeLanguage: "es" | "de" | null;
};

type UserRow = {
  id:                  string;
  email:               string;
  full_name:           string | null;
  active:              boolean;
  language_preference: "es" | "de" | null;
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
  const { data, error } = await sb
    .from("users")
    .select("id, email, full_name, active, language_preference")
    .eq("role", "teacher")
    .eq("active", true);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  const out: HansTeacher[] = ((data ?? []) as UserRow[])
    .map(u => ({
      id:             u.id,
      email:          (u.email ?? "").toLowerCase(),
      fullName:       u.full_name ?? null,
      status:         "active" as const,
      nativeLanguage:
        u.language_preference === "es" || u.language_preference === "de"
          ? u.language_preference
          : null,
    }))
    .sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email));

  return NextResponse.json(out, {
    headers: { "Cache-Control": "no-store" },
  });
}
