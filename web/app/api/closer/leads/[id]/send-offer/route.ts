import { NextResponse } from "next/server";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { buildPagoUrl } from "@/lib/enrollment-checkout";
import { startChain } from "@/lib/chain-engine";
import { logCloserAction } from "@/lib/closer-actions";
import { sendWhatsappText } from "@/lib/whatsapp";
import { RITMOS, ONE_TIME_PACKS, type RitmoId, type GoalId } from "@/lib/trial-packs";

const ONE_TIME_CLASSES: Record<GoalId, number> = {
  a1_a2: 32, b1: 48, b2: 48, c1: 64, fluidez_total: 96,
};

const ESTANDAR_CLASSES_PER_MONTH = 8;

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const GOAL_SHORT_LABELS: Record<GoalId, string> = {
  a1_a2: "A1-A2", b1: "B1", b2: "B2", c1: "C1", fluidez_total: "Fluidez Total",
};

function computeFechaLlegada(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const { id: leadId } = await params;

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("closer_id, email, name, whatsapp_normalized")
    .eq("id", leadId)
    .single();

  if (!lead || (lead as { closer_id: string | null }).closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const category = body.category as "subscription" | "one_time" | undefined;
  const ritmoId = body.ritmoId as RitmoId | undefined;
  const goalId = body.goalId as GoalId | undefined;

  if (!category) return NextResponse.json({ error: "missing_category" }, { status: 400 });

  let productName: string;
  let packLabel: string;
  let tipo_pago: "suscripcion" | "unico";
  let clases_totales: number;
  let clases_por_mes: number | null = null;
  let importe_cents: number;
  let monthlyPriceCents: number | null = null;
  let meta: string;
  let ritmo: string | null = null;
  let metaLabel: string;
  let ritmoLabel: string;
  let fechaLlegada: string;
  let isOneTime = false;

  if (category === "subscription") {
    if (!ritmoId || !goalId) return NextResponse.json({ error: "missing_ritmo_or_goal" }, { status: 400 });
    const r = RITMOS.find(x => x.id === ritmoId);
    const g = r?.goals.find(x => x.id === goalId);
    if (!r || !g) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

    meta = goalId;
    ritmo = ritmoId;
    tipo_pago = "suscripcion";
    clases_totales = g.months * r.classesPerMonth;
    clases_por_mes = r.classesPerMonth;
    importe_cents = g.totalCents;
    monthlyPriceCents = r.pricePerMonth * 100;
    packLabel = `${r.emoji} ${r.name} · Meta ${g.label} · ${g.months} meses`;
    productName = `${r.name} — Meta ${g.label}`;
    metaLabel = g.label;
    ritmoLabel = r.name;
    fechaLlegada = computeFechaLlegada(g.months);
  } else if (category === "one_time") {
    if (!goalId) return NextResponse.json({ error: "missing_goal" }, { status: 400 });
    const p = ONE_TIME_PACKS.find(x => x.id === goalId);
    if (!p) return NextResponse.json({ error: "invalid_pack" }, { status: 400 });

    const classes = ONE_TIME_CLASSES[goalId] ?? 32;
    const refMonths = Math.ceil(classes / ESTANDAR_CLASSES_PER_MONTH);
    meta = goalId;
    tipo_pago = "unico";
    clases_totales = classes;
    importe_cents = p.priceCents;
    packLabel = p.name;
    productName = p.name;
    metaLabel = GOAL_SHORT_LABELS[goalId] || p.name;
    ritmoLabel = "";
    fechaLlegada = computeFechaLlegada(refMonths);
    isOneTime = true;
  } else {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const leadRow = lead as { email: string | null; name: string | null; whatsapp_normalized: string | null };

  // Get teacher_id from trial class (for trazabilidad E2)
  const { data: trialClass } = await sb
    .from("classes")
    .select("teacher_id")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const teacherId = (trialClass as { teacher_id?: string } | null)?.teacher_id ?? null;

  const { data: oferta, error: insertErr } = await sb
    .from("ofertas_enviadas")
    .insert({
      lead_id: leadId,
      teacher_id: teacherId,
      closer_id: closerId,
      meta,
      ritmo,
      tipo_pago,
      clases_totales,
      clases_por_mes,
      importe_cents,
    })
    .select("id")
    .single();

  if (insertErr || !oferta) {
    console.error("[closer/send-offer] insert failed:", insertErr);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const ofertaId = (oferta as { id: string }).id;

  // Link corto en nuestro dominio (b2c.../pago/xxx). La Checkout
  // Session real se crea cuando el lead VISITA el link — así el
  // mensaje de WhatsApp lleva una URL limpia (no la de 500+ chars de
  // checkout.stripe.com, caso Nancy 2026-08-05) y el link no caduca.
  const checkoutUrl = buildPagoUrl(ofertaId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "closer",
    content: `Enlace de inscripcion enviado: ${packLabel} · ${(importe_cents / 100).toLocaleString("es-ES")} €`,
    metadata: {
      kind: "offer_sent",
      oferta_id: ofertaId,
      closer_id: closerId,
      category,
    },
  });

  await logCloserAction({
    closerId,
    leadId,
    tipo: "nota",
    contenido: `Enlace de inscripcion: ${packLabel}`,
    resultado: "mensaje_enviado",
  });

  const firstName = (leadRow.name || "").split(/\s+/)[0] || "";
  const waPhone = leadRow.whatsapp_normalized;

  if (waPhone) {
    const text = isOneTime
      ? [
          `¡Hola ${firstName}! 😊`,
          ``,
          `Me alegra que hayas decidido dar el paso. Aquí tienes tu inscripción al programa ${metaLabel} (pago único: todas tus clases desbloqueadas desde el día 1) — a tu ritmo: con 2 clases por semana, tu ${metaLabel} llega en ${fechaLlegada} 📅`,
          `Y con tu inscripción queda activada tu Garantía de Nivel por escrito.`,
          `👉 ${checkoutUrl}`,
          ``,
          `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
        ].join("\n")
      : [
          `¡Hola ${firstName}! 😊`,
          ``,
          `Me alegra que hayas decidido dar el paso. Aquí tienes tu inscripción al programa ${metaLabel} con ritmo ${ritmoLabel} — empezando esta semana, tu ${metaLabel} llega en ${fechaLlegada} 📅`,
          `Y con tu inscripción queda activada tu Garantía de Nivel por escrito.`,
          `👉 ${checkoutUrl}`,
          ``,
          `Son 5 minutos. Cualquier duda durante el proceso, aquí estoy 😊`,
        ].join("\n");

    const waRes = await sendWhatsappText(waPhone, text, {
      kind: "closer_inscription_initial",
    });

    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: waRes.ok ? "system_message_sent" : "send_failed",
      author: "closer",
      content: waRes.ok
        ? `💬 Enlace de inscripción enviado por WhatsApp a ${waPhone}`
        : `💬 Falló el envío del enlace: ${waRes.reason}`,
      metadata: { kind: "closer_inscription_initial", channel: "whatsapp" },
    });
  }

  await startChain(leadId, "chain2_link_sent", {
    fullUrl: checkoutUrl,
    packLabel,
  });

  return NextResponse.json({ ok: true, ofertaId, checkoutUrl });
}
