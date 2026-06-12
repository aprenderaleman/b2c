/**
 * POST /api/public/funnel/track
 *
 * Telemetría granular del funnel diagnóstico. El cliente la llama
 * cada vez que un visitante AVANZA un paso (clickea opción y entra
 * al siguiente paso). Idempotente por (session_id, step) — si el
 * cliente reintenta, no duplica.
 *
 * Diferencia con /api/public/motivo (que se mantiene): /motivo crea
 * una fila en lead_motivo_inicial específica para enlazar con leads.
 * Este endpoint es genérico para CUALQUIER paso del funnel, vive en
 * funnel_progress, y alimenta /admin/ads. NO crea leads.
 *
 * Body:
 *   {
 *     session_id: "abc123...",       // 8-64 chars, persistente en cliente
 *     step:       1 | 2 | 3 | 4 | 5,
 *     answer:     "intensivo" | "A1 — Conozco..." | null,
 *   }
 *
 * Fail-soft: si la BD falla, devolvemos 200 — no queremos romper el
 * UX por telemetría que no es crítica para el flow.
 */
import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { createHash }                 from "node:crypto";
import { supabaseAdmin }              from "@/lib/supabase";
import { ipFromHeaders }              from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  session_id: z.string().trim().min(8).max(64),
  step:       z.number().int().min(1).max(7),
  // 200 chars cubre los textos más largos del quiz (e.g., los niveles
  // MCER con descripción). Truncamos en BD para evitar abuso.
  answer:     z.string().trim().max(200).nullable().optional(),
  // De qué landing llega el visitante. Slugs estables: 'home',
  // 'curso-online', 'particulares', 'intensivo', 'certificado',
  // 'b2-trabajar', 'ciudades' (más futuros). Migration 058.
  landing_intent: z.string().trim().max(40).nullable().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { session_id, step, answer, landing_intent } = parsed.data;

  // Hash de IP para detectar bots sin guardar PII.
  const ip = ipFromHeaders(req);
  const ipHash = createHash("sha256").update(`fp:${ip}`).digest("hex").slice(0, 16);
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;

  try {
    const sb = supabaseAdmin();
    // INSERT con ON CONFLICT DO NOTHING — idempotente por unique
    // index (session_id, step). El primer hit gana, los reintentos
    // se ignoran silenciosamente.
    await sb.from("funnel_progress").insert({
      session_id,
      step,
      answer: answer ?? null,
      user_agent: ua,
      ip_hash:    ipHash,
      landing_intent: landing_intent ?? null,
    });
  } catch (e) {
    // Fail-soft — no rompemos el UX por telemetría.
    console.error("[funnel/track] insert failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
