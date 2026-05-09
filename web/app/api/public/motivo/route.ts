import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";

/**
 * POST /api/public/motivo
 *
 * Guarda la respuesta del nuevo paso 1 del funnel (motivo_inicial)
 * antes de que el lead exista. El cliente genera un session_id (uuid)
 * que se persistirá luego en `leads.motivo_inicial` y se enlazará a
 * la fila de `lead_motivo_inicial` cuando el funnel se complete.
 *
 * El endpoint es UPSERT por session_id: si el usuario cambia de
 * elección antes de avanzar, sobreescribe sin crear filas duplicadas.
 *
 * Body: { session_id: uuid, motivo: 'particulares'|'intensivo'|'certificado'|'profesional'|'otro' }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOTIVOS = ["particulares","intensivo","certificado","profesional","otro"] as const;

const BodySchema = z.object({
  session_id: z.string().trim().min(8).max(64),
  motivo:     z.enum(MOTIVOS),
});

export async function POST(req: NextRequest) {
  // Rate-limit suave por IP — un usuario puede clickear varias veces;
  // no queremos bloquearlo. 60 / minuto es generoso pero corta abusos.
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({
    scope: "motivo_inicial", key: ip, max: 60, windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("lead_motivo_inicial")
    .upsert(
      { session_id: parsed.data.session_id, motivo: parsed.data.motivo, lead_id: null },
      { onConflict: "session_id" },
    );
  if (error) {
    console.error("[motivo] upsert failed:", error.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
