import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/debug/schule-test?userId=<uuid>
 *
 * Endpoint de DEBUG (no productivo). Hace la llamada SSO a Schule
 * como si fuera el alumno indicado y devuelve la respuesta cruda
 * para diagnosticar fallos de upsert.
 *
 * Devuelve:
 *   - status HTTP que Schule respondió
 *   - cuerpo crudo (texto, hasta 2000 chars)
 *   - lo que se envió (sin el secret)
 *
 * Auth: admin / superadmin solamente. Quitar después del fix.
 */
export async function GET(req: Request) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "single";
  const SCHULE_BASE = process.env.SCHULE_API_URL ?? "https://api-schule.aprender-aleman.de";
  const secret      = process.env.B2C_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "no_secret_configured" }, { status: 500 });
  }

  const sb = supabaseAdmin();

  // BATCH MODE: test SSO for a roster of users and report status per user.
  // Para diagnosticar si Schule está roto globalmente o solo para algunos.
  if (mode === "batch") {
    const { data: users } = await sb
      .from("users")
      .select("id, email, full_name, phone")
      .eq("role", "student")
      .order("created_at", { ascending: false })
      .limit(15);
    const arr = (users ?? []) as Array<{ id: string; email: string; full_name: string | null; phone: string | null }>;

    const results: Array<Record<string, unknown>> = [];
    for (const u of arr) {
      try {
        const res = await fetch(`${SCHULE_BASE}/api/b2c/sso-link`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ email: u.email, full_name: u.full_name ?? undefined, phone: u.phone ?? undefined, secret }),
          cache:   "no-store",
        });
        const body = await res.text();
        results.push({
          email:    u.email,
          name:     u.full_name,
          phone:    u.phone,
          status:   res.status,
          bodySnip: body.slice(0, 200),
        });
      } catch (e) {
        results.push({ email: u.email, error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Schule health-ish: ping with bad secret to confirm endpoint alive
    let health: Record<string, unknown> = {};
    try {
      const h = await fetch(`${SCHULE_BASE}/api/b2c/sso-link`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ping@x.x", secret: "ping" }), cache: "no-store",
      });
      health = { status: h.status, body: (await h.text()).slice(0, 200) };
    } catch (e) {
      health = { error: e instanceof Error ? e.message : String(e) };
    }
    return NextResponse.json({ mode: "batch", schule_url: SCHULE_BASE, health, count: arr.length, results });
  }

  // SINGLE MODE: detailed test for one user.
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "missing_userId (or use ?mode=batch)" }, { status: 400 });
  }

  const { data: u } = await sb
    .from("users")
    .select("email, full_name, phone, role")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const variants = [
    { label: "con teléfono", payload: { email: u.email, full_name: u.full_name ?? undefined, phone: u.phone ?? undefined } },
    { label: "sin teléfono", payload: { email: u.email, full_name: u.full_name ?? undefined } },
    { label: "solo email",   payload: { email: u.email } },
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const v of variants) {
    try {
      const res = await fetch(`${SCHULE_BASE}/api/b2c/sso-link`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...v.payload, secret }),
        cache:   "no-store",
      });
      const body = await res.text();
      results.push({ variant: v.label, sent: v.payload, status: res.status, ok: res.ok, bodyText: body.slice(0, 2000) });
    } catch (e) {
      results.push({ variant: v.label, sent: v.payload, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({
    schule_url: SCHULE_BASE,
    user:       { id: userId, email: u.email, full_name: u.full_name, phone: u.phone },
    results,
  });
}
