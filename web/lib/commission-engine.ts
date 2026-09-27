import { supabaseAdmin } from "./supabase";

type RegisterOpts = {
  teacherId: string;
  studentId: string;
  amountCents: number;
  currency: string;
  stripePiId: string;
  stripeInvoiceId?: string | null;
  escenario?: string;
};

export async function registerCommission(opts: RegisterOpts): Promise<number> {
  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", opts.teacherId)
    .maybeSingle();
  if (!teacher) {
    console.warn("[commission-engine] teacher not found:", opts.teacherId);
    return 0;
  }
  const teacherUserId = (teacher as { user_id: string }).user_id;

  const { data: userRow } = await sb
    .from("users")
    .select("rango")
    .eq("id", teacherUserId)
    .maybeSingle();
  const rango = (userRow as { rango: string | null } | null)?.rango ?? "starter";

  const { data: rangoRow } = await sb
    .from("config_rangos")
    .select("comision_pct")
    .eq("rol", "teacher")
    .eq("rango", rango)
    .maybeSingle();
  const pct = (rangoRow as { comision_pct: number } | null)?.comision_pct ?? 5;

  const commissionCents = Math.round(opts.amountCents * pct / 100);
  if (commissionCents <= 0) return 0;

  const mes = new Date().toISOString().slice(0, 7) + "-01";

  const { data: comision, error: insertErr } = await sb
    .from("comisiones")
    .insert({
      student_id: opts.studentId,
      usuario_id: teacherUserId,
      rol: "teacher",
      tipo: "conversion",
      monto_cents: commissionCents,
      stripe_payment_intent_id: opts.stripePiId,
      stripe_invoice_id: opts.stripeInvoiceId ?? null,
      base_amount_cents: opts.amountCents,
      comision_pct: pct,
      escenario: opts.escenario ?? "E1",
      mes,
      pagado: false,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log("[commission-engine] idempotent skip:", opts.stripePiId, teacherUserId);
      return 0;
    }
    console.error("[commission-engine] insert failed:", insertErr);
    return 0;
  }

  const { error: rpcErr } = await sb.rpc("recompute_teacher_month", {
    p_teacher_id: opts.teacherId,
    p_any_date_in_month: new Date().toISOString(),
  });
  if (rpcErr) console.error("[commission-engine] recompute failed:", rpcErr);

  console.log(`[commission-engine] ${rango} ${pct}% on ${opts.amountCents}¢ = ${commissionCents}¢ for teacher ${opts.teacherId}`);
  return commissionCents;
}

/**
 * Bono de cierre: monto fijo al confirmarse el primer pago de cada conversión.
 * Idempotente: UNIQUE(stripe_payment_intent_id, usuario_id) previene duplicados.
 */
/**
 * Ritmo/pago → clave de config del bono. Decisión Gelfis 2026-09-27: el
 * bono escala con lo que vende el profe (Viajero 25 · Estándar 35 ·
 * Intensivo 50 · VIP Express 75 · pago único 150). `bono_cierre_cents`
 * queda como fallback si el ritmo no se reconoce.
 */
export function bonoCierreKey(ritmo: string | null | undefined, tipoPago: string | null | undefined): string {
  if (tipoPago && tipoPago !== "suscripcion") return "pago_unico";
  const r = (ritmo ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (r === "viajero" || r === "estandar" || r === "intensivo" || r === "vip_express") return r;
  return "default";
}

export async function resolveBonoCierreCents(
  sb: ReturnType<typeof supabaseAdmin>,
  ritmo: string | null | undefined,
  tipoPago: string | null | undefined,
): Promise<{ cents: number; key: string }> {
  const key = bonoCierreKey(ritmo, tipoPago);
  const claves = key === "default" ? ["bono_cierre_cents"] : [`bono_cierre_${key}_cents`, "bono_cierre_cents"];
  const { data } = await sb.from("config_comisiones").select("clave, valor").in("clave", claves);
  const rows = (data ?? []) as { clave: string; valor: string }[];
  const pick = claves.map((c) => rows.find((r) => r.clave === c)).find(Boolean);
  return { cents: Math.round(Number(pick?.valor ?? 5000)), key };
}

export async function registerBonoCierre(opts: {
  teacherId: string;
  studentId: string;
  stripePiId: string;
  studentName: string;
  mes?: string;
  /** Ritmo de la oferta aceptada (viajero/estandar/intensivo/vip_express). */
  ritmo?: string | null;
  /** ofertas_enviadas.tipo_pago: "suscripcion" o pago único. */
  tipoPago?: string | null;
}): Promise<number> {
  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", opts.teacherId)
    .maybeSingle();
  if (!teacher) return 0;
  const teacherUserId = (teacher as { user_id: string }).user_id;

  const { cents: bonoCents, key: bonoKey } = await resolveBonoCierreCents(sb, opts.ritmo, opts.tipoPago);
  if (bonoCents <= 0) return 0;

  const piKey = `bono_cierre_${opts.stripePiId}`;
  const mes = opts.mes ?? new Date().toISOString().slice(0, 7) + "-01";

  const { data: comision, error: insertErr } = await sb
    .from("comisiones")
    .insert({
      student_id: opts.studentId,
      usuario_id: teacherUserId,
      rol: "teacher",
      tipo: "bono_cierre",
      monto_cents: bonoCents,
      stripe_payment_intent_id: piKey,
      base_amount_cents: 0,
      comision_pct: 0,
      // "bono_cierre:<ritmo>" — la factura PDF muestra el ritmo premiado.
      escenario: bonoKey === "default" ? "bono_cierre" : `bono_cierre:${bonoKey}`,
      mes,
      pagado: false,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log("[commission-engine] bono_cierre idempotent skip:", opts.stripePiId);
      return 0;
    }
    console.error("[commission-engine] bono_cierre insert failed:", insertErr);
    return 0;
  }

  const { error: rpcErr } = await sb.rpc("recompute_teacher_month", {
    p_teacher_id: opts.teacherId,
    p_any_date_in_month: new Date().toISOString(),
  });
  if (rpcErr) console.error("[commission-engine] bono recompute failed:", rpcErr);

  console.log(`[commission-engine] bono_cierre ${bonoCents}¢ for teacher ${opts.teacherId} (student: ${opts.studentName})`);
  return bonoCents;
}

export function isInCommissionWindow(commissionWindowEnd: string | null): boolean {
  if (!commissionWindowEnd) return false;
  return new Date(commissionWindowEnd) > new Date();
}
