import { supabaseAdmin } from "./supabase";

type ConfigComision = { clave: string; valor: number };

async function getConfig(): Promise<Record<string, number>> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("config_comisiones").select("clave, valor");
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as ConfigComision[]) {
    map[row.clave] = Number(row.valor);
  }
  return map;
}

type RangoConfig = {
  rango: string;
  comision_pct: number;
  min_close_rate: number;
  min_conversiones: number;
};

async function getRangoForUser(
  userId: string,
  rol: "teacher" | "closer",
): Promise<RangoConfig> {
  const sb = supabaseAdmin();

  const { data: user } = await sb
    .from("users")
    .select("rango")
    .eq("id", userId)
    .single();

  const { data: rangos } = await sb
    .from("config_rangos")
    .select("rango, comision_pct, min_close_rate, min_conversiones")
    .eq("rol", rol)
    .order("comision_pct", { ascending: true });

  const rangosList = (rangos ?? []) as RangoConfig[];
  const currentRango = user?.rango as string | null;

  if (currentRango) {
    const found = rangosList.find((r) => r.rango === currentRango);
    if (found) return found;
  }

  return rangosList[0] ?? { rango: "starter", comision_pct: 5, min_close_rate: 0, min_conversiones: 0 };
}

/**
 * Tarifas fijas pactadas con el closer (migración 167, acuerdo con Iván
 * 2026-11-27): si existen, sustituyen al sistema de rangos. El % depende
 * del tipo de pago de la venta: 'unico'/'single' → closer_pct_unico;
 * 'suscripcion'/'flexible'/'extended' → closer_pct_suscripcion (sobre la
 * PRIMERA mensualidad — monto_cents de la venta es el primer cobro).
 * Sin bono de rescate y sin tope de pool: el acuerdo individual promete
 * el % plano. NULL en cualquiera de las dos columnas = por rango.
 */
async function getCloserCustomPct(
  closerId: string,
  paymentType: string | null,
): Promise<number | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("closer_pct_unico, closer_pct_suscripcion")
    .eq("id", closerId)
    .maybeSingle();
  const u = data as { closer_pct_unico: number | string | null; closer_pct_suscripcion: number | string | null } | null;
  if (!u || u.closer_pct_unico == null || u.closer_pct_suscripcion == null) return null;
  const esUnico = paymentType === "unico" || paymentType === "single";
  return Number(esUnico ? u.closer_pct_unico : u.closer_pct_suscripcion);
}

export type ComisionResult = {
  usuario_id: string;
  rol: "teacher" | "closer";
  tipo: "comision_base" | "bono_rescate" | "comision_precalificacion";
  monto_cents: number;
  porcentaje_teorico: number;
  porcentaje_aplicado: number;
  pool_cap_aplicado: boolean;
};

export type CalculateCommissionsOpts = {
  stripePiId?: string;
};

export async function calculateCommissions(
  ventaId: string,
  opts?: CalculateCommissionsOpts,
): Promise<ComisionResult[]> {
  const sb = supabaseAdmin();

  const { data: venta } = await sb
    .from("ventas")
    .select("*, leads!inner(closer_id, status)")
    .eq("id", ventaId)
    .single();

  if (!venta) throw new Error("venta_not_found");

  const montoCents = venta.monto_cents as number;
  if (!montoCents || montoCents <= 0) return [];

  const config = await getConfig();
  const poolMax = config.pool_maximo ?? 18;
  const bonusRescate = config.bonus_rescate_closer ?? 3;
  const factorPreCalif = config.factor_profe_precalificacion ?? 0.5;

  const closerId = (venta.leads as { closer_id: string | null }).closer_id;

  const { data: trialClass } = await sb
    .from("classes")
    .select("teacher_id, status")
    .eq("lead_id", venta.lead_id)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .order("scheduled_at", { ascending: false })
    .limit(1);

  const teacherTableId = (trialClass?.[0] as { teacher_id?: string } | undefined)?.teacher_id ?? null;
  const trialAttended = (trialClass?.[0] as { status?: string } | undefined)?.status === "completed";

  let teacherUserId: string | null = null;
  if (teacherTableId) {
    const { data: teacher } = await sb
      .from("teachers")
      .select("user_id")
      .eq("id", teacherTableId)
      .maybeSingle();
    teacherUserId = (teacher as { user_id: string } | null)?.user_id ?? null;
  }

  const comisiones: ComisionResult[] = [];
  let escenario: string;
  let hasCustomCloser = false;

  if (!closerId) {
    escenario = "E1";
    if (teacherUserId) {
      const rango = await getRangoForUser(teacherUserId, "teacher");
      const pct = rango.comision_pct;
      comisiones.push({
        usuario_id: teacherUserId,
        rol: "teacher",
        tipo: "comision_base",
        monto_cents: Math.round((montoCents * pct) / 100),
        porcentaje_teorico: pct,
        porcentaje_aplicado: pct,
        pool_cap_aplicado: false,
      });
    }
  } else if (closerId && trialAttended) {
    escenario = "E2";
    const customPct = await getCloserCustomPct(closerId, venta.payment_type as string | null);
    const pctCloser = customPct ?? (await getRangoForUser(closerId, "closer")).comision_pct;
    if (customPct != null) hasCustomCloser = true;
    comisiones.push({
      usuario_id: closerId,
      rol: "closer",
      tipo: "comision_base",
      monto_cents: Math.round((montoCents * pctCloser) / 100),
      porcentaje_teorico: pctCloser,
      porcentaje_aplicado: pctCloser,
      pool_cap_aplicado: false,
    });

    if (teacherUserId) {
      const rangoProfe = await getRangoForUser(teacherUserId, "teacher");
      const pctProfe = rangoProfe.comision_pct * factorPreCalif;
      comisiones.push({
        usuario_id: teacherUserId,
        rol: "teacher",
        tipo: "comision_precalificacion",
        monto_cents: Math.round((montoCents * pctProfe) / 100),
        porcentaje_teorico: rangoProfe.comision_pct,
        porcentaje_aplicado: pctProfe,
        pool_cap_aplicado: false,
      });
    }
  } else {
    escenario = "E3";
    const customPct = await getCloserCustomPct(closerId, venta.payment_type as string | null);
    const pctCloser = customPct ?? (await getRangoForUser(closerId, "closer")).comision_pct;
    if (customPct != null) hasCustomCloser = true;
    comisiones.push({
      usuario_id: closerId,
      rol: "closer",
      tipo: "comision_base",
      monto_cents: Math.round((montoCents * pctCloser) / 100),
      porcentaje_teorico: pctCloser,
      porcentaje_aplicado: pctCloser,
      pool_cap_aplicado: false,
    });
    // Bono de rescate solo en el sistema de rangos: las tarifas fijas
    // pactadas son un % plano (ver getCloserCustomPct).
    if (customPct == null) {
      comisiones.push({
        usuario_id: closerId,
        rol: "closer",
        tipo: "bono_rescate",
        monto_cents: Math.round((montoCents * bonusRescate) / 100),
        porcentaje_teorico: bonusRescate,
        porcentaje_aplicado: bonusRescate,
        pool_cap_aplicado: false,
      });
    }
  }

  // Pool cap — no aplica cuando el closer tiene tarifas fijas pactadas:
  // su acuerdo promete el % exacto (la pre-calificación del profe queda
  // igualmente por debajo del tope por sí sola).
  const totalPct = comisiones.reduce((sum, c) => sum + c.porcentaje_aplicado, 0);
  if (!hasCustomCloser && totalPct > poolMax && comisiones.length > 0) {
    const factor = poolMax / totalPct;
    for (const c of comisiones) {
      c.porcentaje_aplicado = Math.round(c.porcentaje_aplicado * factor * 100) / 100;
      c.monto_cents = Math.round((montoCents * c.porcentaje_aplicado) / 100);
      c.pool_cap_aplicado = true;
    }
  }

  // Persist
  const mes = new Date().toISOString().slice(0, 7) + "-01";
  if (comisiones.length > 0) {
    const rows = comisiones.map((c) => ({
      venta_id: ventaId,
      usuario_id: c.usuario_id,
      rol: c.rol,
      tipo: c.tipo,
      monto_cents: c.monto_cents,
      porcentaje_aplicado: c.porcentaje_aplicado,
      porcentaje_teorico: c.porcentaje_teorico,
      pool_cap_aplicado: c.pool_cap_aplicado,
      base_amount_cents: montoCents,
      escenario,
      mes,
      pagado: false,
      ...(opts?.stripePiId ? { stripe_payment_intent_id: opts.stripePiId } : {}),
    }));
    await sb.from("comisiones").insert(rows);
  }

  // Teacher payroll: recompute (commissions read from comisiones table)
  if (teacherTableId) {
    await sb.rpc("recompute_teacher_month", {
      p_teacher_id: teacherTableId,
      p_any_date_in_month: new Date().toISOString(),
    }).then(
      () => {},
      (err) => console.error("[closer-commissions] recompute failed:", err),
    );
  }

  return comisiones;
}

export type CloserStats = {
  leads_asignados: number;
  leads_contactados: number;
  leads_convertidos: number;
  leads_perdidos: number;
  close_rate: number;
  comisiones_cents: number;
};

export type DetailedCloserStats = CloserStats & {
  comisiones_by_tipo: {
    comision_base: number;
    bono_rescate: number;
    comision_precalificacion: number;
  };
  tasa_contacto: number;
};

export async function getCloserStats(
  closerId: string,
  desde: Date,
  hasta: Date,
): Promise<CloserStats> {
  const sb = supabaseAdmin();

  const { data: leads } = await sb
    .from("leads")
    .select("id, estado_cierre")
    .eq("closer_id", closerId)
    .gte("fecha_asignacion_closer", desde.toISOString())
    .lt("fecha_asignacion_closer", hasta.toISOString());

  const all = (leads ?? []) as Array<{ id: string; estado_cierre: string }>;
  const asignados = all.length;
  const convertidos = all.filter((l) => l.estado_cierre === "convertido").length;
  const perdidos = all.filter((l) => l.estado_cierre === "perdido").length;

  const { data: acciones } = await sb
    .from("acciones_closer")
    .select("lead_id")
    .eq("closer_id", closerId)
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString());

  const contactados = new Set((acciones ?? []).map((a: { lead_id: string }) => a.lead_id)).size;

  const { data: comisiones } = await sb
    .from("comisiones")
    .select("monto_cents")
    .eq("usuario_id", closerId)
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString());

  const comisionesCents = (comisiones ?? []).reduce(
    (sum: number, c: { monto_cents: number }) => sum + c.monto_cents,
    0,
  );

  const closeRate = asignados > 0 ? (convertidos / asignados) * 100 : 0;

  return {
    leads_asignados: asignados,
    leads_contactados: contactados,
    leads_convertidos: convertidos,
    leads_perdidos: perdidos,
    close_rate: Math.round(closeRate * 100) / 100,
    comisiones_cents: comisionesCents,
  };
}

export async function getCloserDetailedStats(
  closerId: string,
  desde: Date,
  hasta: Date,
): Promise<DetailedCloserStats> {
  const base = await getCloserStats(closerId, desde, hasta);

  const sb = supabaseAdmin();

  const { data: comisiones } = await sb
    .from("comisiones")
    .select("tipo, monto_cents")
    .eq("usuario_id", closerId)
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString());

  const rows = (comisiones ?? []) as Array<{ tipo: string; monto_cents: number }>;

  const byTipo = { comision_base: 0, bono_rescate: 0, comision_precalificacion: 0 };
  for (const c of rows) {
    const key = c.tipo as keyof typeof byTipo;
    if (key in byTipo) byTipo[key] += c.monto_cents;
  }

  return {
    ...base,
    comisiones_by_tipo: byTipo,
    tasa_contacto: base.leads_asignados > 0
      ? Math.round((base.leads_contactados / base.leads_asignados) * 10000) / 100
      : 0,
  };
}
