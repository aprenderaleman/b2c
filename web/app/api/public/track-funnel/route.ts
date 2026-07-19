import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";

/**
 * POST /api/public/track-funnel
 *
 * Endpoint público para insertar eventos del funnel desde el cliente.
 * Alimenta la tabla `funnel_progress` con los códigos de step de
 * lib/track-funnel.ts (10-16 para instrumentación granular, 1-6 para
 * quiz Diagnostico legacy).
 *
 * Rate limit: 60 req/min/IP para prevenir flood. Suficiente para un
 * flow real (~10 eventos por lead) con margen.
 *
 * NO valida el step code — cualquier smallint pasa. La app maneja
 * códigos desconocidos como "otros" en /admin/funnel.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type Body = {
  session_id?:     string;
  step?:           number;
  answer?:         string | null;
  landing_intent?: string | null;
};

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({
    scope:    "track_funnel",
    key:      ip,
    max:      60,
    windowMs: 60_000,
  });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!body.session_id || typeof body.session_id !== "string" || body.session_id.length > 100) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  }
  if (typeof body.step !== "number" || body.step < 1 || body.step > 999) {
    return NextResponse.json({ error: "invalid_step" }, { status: 400 });
  }

  // ip_hash: SHA-256(ip + salt). Salt = NEXTAUTH_SECRET para no derivar
  // IPs desde el hash. Cumple con GDPR (pseudonimización).
  const salt = process.env.NEXTAUTH_SECRET ?? "aa-fallback";
  const ipHash = createHash("sha256").update(ip + salt).digest("hex").slice(0, 32);
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  const sb = supabaseAdmin();
  const { error } = await sb.from("funnel_progress").insert({
    session_id:     body.session_id,
    step:           body.step,
    answer:         body.answer?.slice(0, 500) ?? null,
    landing_intent: body.landing_intent?.slice(0, 40) ?? null,
    ip_hash:        ipHash,
    user_agent:     userAgent,
  });
  if (error) {
    console.error("[track-funnel] insert failed:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
