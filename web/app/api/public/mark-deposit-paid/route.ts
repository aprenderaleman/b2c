import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyTrialToken } from "@/lib/trial-token";

/**
 * POST /api/public/mark-deposit-paid
 *
 * Llamado por /confirmacion cuando el lead vuelve de Stripe con
 * `?deposito=ok`. Marca `classes.deposit_paid_at = NOW()` si el token
 * es válido para esa clase.
 *
 * MVP: la marca es self-reported (`?deposito=ok` es spoofable). La
 * confirmación real llegará por un webhook de Stripe cuando esté
 * conectado (Gelfis lo configurará después). Para efectos de
 * conversión secundaria y de copy "plaza asegurada" en el cron, la
 * self-report es aceptable porque el peor caso es que un lead
 * malicioso marque como pagado sin haber pagado — no genera pérdida
 * económica (la clase ya era gratis), solo desvía la señal de
 * conversión secundaria.
 *
 * Body: { classId, token }
 * Sin auth adicional — el token HMAC ya limita a la clase específica.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(req: Request) {
  let body: { classId?: string; token?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const { classId, token } = body;
  if (!classId || !token) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const payload = verifyTrialToken(token);
  if (!payload || payload.class_id !== classId) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, deposit_paid_at, is_trial")
    .eq("id", classId)
    .maybeSingle();
  if (!cls || !(cls as { is_trial: boolean }).is_trial) {
    return NextResponse.json({ error: "class_not_found" }, { status: 404 });
  }

  const leadId = (cls as { lead_id: string }).lead_id;

  // Idempotente: si ya está marcada, no re-actualiza (evita duplicar
  // timeline entries y respeta la 1a marca como "hora del pago").
  if ((cls as { deposit_paid_at: string | null }).deposit_paid_at) {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  const paidAt = new Date().toISOString();
  // Doble escritura: classes es source of truth, leads es denormalización
  // para que /admin/funnel filtre + pinte sin necesidad de JOIN. Ambas
  // van en el mismo tick — si una falla, la otra queda sin sincronizar
  // (caso raro, resolvible con una re-marca manual desde /admin/leads).
  await sb.from("classes")
    .update({ deposit_paid_at: paidAt })
    .eq("id", classId);
  await sb.from("leads")
    .update({ deposit_paid_at: paidAt })
    .eq("id", leadId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  "system",
    content: `💳 Depósito 10€ marcado como pagado (self-reported via /confirmacion?deposito=ok).`,
    metadata: { kind: "deposit_paid", class_id: classId, at: paidAt, source: "self_report" },
  });

  return NextResponse.json({ ok: true, paidAt });
}
