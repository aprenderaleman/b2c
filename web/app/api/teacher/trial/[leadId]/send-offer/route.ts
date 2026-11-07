import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAttendedAwaitingConversion, type AttendedOptions } from "@/lib/admin-actions";
import { supabaseAdmin } from "@/lib/supabase";
import { buildPagoUrl } from "@/lib/enrollment-checkout";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";
import {
  RITMOS, ONE_TIME_PACKS, KIDS_PACK, GOAL_CLASSES,
  type RitmoId, type GoalId, type PlanCategory, type PaymentType,
} from "@/lib/trial-packs";
import { isCatalogActive, getActiveCatalog, getCatalogRitmos, getCatalogOneTimePacks, getCatalogKidsPack } from "@/lib/catalog";
import {
  GROUP_FORMAT_LABELS, GROUP_LEVELS, GROUP_PRICES, GROUP_SESSIONS,
  buildGroupUrl, renderGroupOfferMessage,
  type GroupFormat, type GroupLevelId, type GroupRitmo,
} from "@/lib/group-packs";
import { sendWhatsappText } from "@/lib/whatsapp";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function computeFechaLlegada(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
}

const ONE_TIME_CLASSES = GOAL_CLASSES;

const ESTANDAR_CLASSES_PER_MONTH = 8;

const GOAL_SHORT_LABELS: Record<GoalId, string> = {
  a1_a2: "A2",
  b1: "B1",
  b2: "B2",
  c1: "C1",
  fluidez_total: "Fluidez Total",
};

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const category    = body.category as PlanCategory | undefined;
  const ritmoId     = body.ritmoId as RitmoId | undefined;
  const goalId      = body.goalId as GoalId | undefined;
  const kidsPayment = body.kidsPayment as "single" | "flexible" | undefined;

  if (!category) return NextResponse.json({ error: "missing_category" }, { status: 400 });

  // ── Dúo / Trío (Gelfis 2026-10-31) ──────────────────────────────────
  // Rama propia: el enlace es la URL /g/ del sitio raíz (no Stripe-
  // checkout de esta app) y el mensaje viene del preview editable del
  // profesor. El lead paga su parte y reenvía el MISMO enlace a sus
  // compañeros (grp compartido → emparejados en Stripe metadata).
  if ((category as string) === "grupo") {
    const format = body.format as GroupFormat | undefined;
    const lvl    = body.lvl as GroupLevelId | undefined;
    const r      = Number(body.r) as GroupRitmo;
    const rawMsg = typeof body.message === "string" ? body.message.trim() : "";

    if (format !== "duo" && format !== "trio") return NextResponse.json({ error: "invalid_format" }, { status: 400 });
    if (!lvl || !GROUP_LEVELS.some(l => l.id === lvl)) return NextResponse.json({ error: "invalid_lvl" }, { status: 400 });
    if (r !== 2 && r !== 3 && r !== 4) return NextResponse.json({ error: "invalid_ritmo" }, { status: 400 });

    const url = buildGroupUrl(format, lvl, r, leadId);
    // El profesor puede editar el mensaje, pero el enlace /g/ debe
    // sobrevivir a la edición — sin él el lead no puede pagar.
    const message = rawMsg.includes("aprender-aleman.de/g/") ? rawMsg : null;
    if (!message) return NextResponse.json({ error: "message_missing_link", url }, { status: 400 });

    const sbG = supabaseAdmin();
    const { data: tRow } = await sbG.from("teachers").select("id").eq("user_id", user.id).maybeSingle();
    if (!tRow) return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
    const { data: lRow } = await sbG
      .from("leads").select("name, whatsapp_normalized, meta").eq("id", leadId).maybeSingle();
    if (!lRow) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
    const lead = lRow as { name: string | null; whatsapp_normalized: string | null; meta: unknown };

    const priceMonth = GROUP_PRICES[format][lvl][r];
    const sessions   = GROUP_SESSIONS[lvl];
    const label      = `${GROUP_FORMAT_LABELS[format]} ${GROUP_LEVELS.find(l => l.id === lvl)!.label} · ${r}/sem`;

    await sbG.from("ofertas_enviadas").insert({
      lead_id:        leadId,
      teacher_id:     (tRow as { id: string }).id,
      meta:           lvl,
      ritmo:          `${format}_${r}sem`,
      tipo_pago:      "suscripcion",
      clases_totales: sessions,
      clases_por_mes: r * 4,
      importe_cents:  priceMonth * 100,
      // URL exacta enviada — el grp lleva el mes, regenerarla otro mes
      // crearía un grupo distinto (migración 152, botón Copiar enlace).
      checkout_url:   url,
    });

    // WhatsApp al lead — mismo kind whitelisted que la oferta individual.
    const wa = await sendWhatsappText(lead.whatsapp_normalized, message, { kind: "trial_inscription_initial" });

    // Lead a trial_attended + awaiting payment (espejo reducido de
    // markTrialAttendedAwaitingConversion, sin sus mensajes automáticos).
    const existingMeta = (lead.meta && typeof lead.meta === "object") ? lead.meta as Record<string, unknown> : {};
    await sbG.from("leads").update({
      status:            "trial_attended",
      trial_attended_at: new Date().toISOString(),
      next_contact_date: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
      meta: {
        ...existingMeta,
        awaiting_payment_confirmation_since: new Date().toISOString(),
        last_offered_pack:    `${format}_${lvl}`,
        last_offered_payment: "flexible",
      },
    }).eq("id", leadId);

    await sbG.from("lead_timeline").insert({
      lead_id: leadId,
      type: "agent_note",
      author: "system",
      content: `👥 Oferta ${label} enviada: ${priceMonth} €/mes/persona · ${sessions} sesiones de 90 min${wa.ok ? "" : ` · ⚠️ WhatsApp NO salió (${wa.reason ?? "error"})`}`,
      metadata: { kind: "offer_sent", category: "grupo", format, lvl, ritmo: r, url, wa_ok: wa.ok },
    });

    await registerContact({
      leadId,
      actor: await actorFromPanelUser(user),
      actionType: "enviar_enlace",
      channel: "whatsapp",
      note: `Oferta ${label} · ${priceMonth} €/mes/persona`,
    });

    return NextResponse.json({ ok: true, url, waSent: wa.ok, waReason: wa.ok ? null : (wa.reason ?? "error") });
  }

  let meta: string;
  let ritmo: string | null = null;
  let tipo_pago: "suscripcion" | "unico";
  let clases_totales: number;
  let clases_por_mes: number | null = null;
  let importe_cents: number;
  let monthlyPriceCents: number | null = null;
  let packLabel: string | undefined;
  let packId: string;
  let paymentType: PaymentType;
  let productName: string;
  let metaLabel: string;
  let ritmoLabel: string;
  let fechaLlegada: string;
  let isOneTime = false;

  // Use catalog prices when active (v2+), otherwise fall back to constants
  const useCatalog = await isCatalogActive();
  const catRitmos = useCatalog ? await getCatalogRitmos() : RITMOS;
  const catOneTime = useCatalog ? await getCatalogOneTimePacks() : ONE_TIME_PACKS;
  const catKids = useCatalog ? await getCatalogKidsPack() : KIDS_PACK;

  if (category === "subscription") {
    if (!ritmoId || !goalId) return NextResponse.json({ error: "missing_ritmo_or_goal" }, { status: 400 });
    const r = catRitmos.find(x => x.id === ritmoId);
    const g = r?.goals.find(x => x.id === goalId);
    if (!r || !g) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

    meta = goalId;
    ritmo = ritmoId;
    tipo_pago = "suscripcion";
    clases_totales = g.classes;
    clases_por_mes = r.classesPerMonth;
    importe_cents = g.totalCents;
    monthlyPriceCents = r.pricePerMonth * 100;
    packLabel = `${r.emoji} ${r.name} · Meta ${g.label} · ${g.months} meses`;
    productName = `${r.name} — Meta ${g.label}`;
    metaLabel = g.label;
    ritmoLabel = r.name;
    fechaLlegada = computeFechaLlegada(g.months);
    packId = ritmoId;
    paymentType = "flexible";
  } else if (category === "one_time") {
    if (!goalId) return NextResponse.json({ error: "missing_goal" }, { status: 400 });
    const p = catOneTime.find(x => x.id === goalId);
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
    packId = goalId;
    paymentType = "single";
  } else if (category === "kids") {
    const kids = catKids ?? KIDS_PACK;
    meta = "kids";
    tipo_pago = "unico";
    clases_totales = kids.classes;
    importe_cents = kids.priceCents;
    packLabel = "Pack Kids";
    productName = "Pack Kids — Alemán para niños";
    metaLabel = "Pack Kids";
    ritmoLabel = "";
    fechaLlegada = computeFechaLlegada(6);
    isOneTime = true;
    packId = "kids";
    paymentType = kidsPayment === "flexible" ? "flexible" : "single";
  } else {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: teacherRow } = await sb
    .from("teachers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!teacherRow) return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
  const teacherId = (teacherRow as { id: string }).id;

  const { data: leadRow } = await sb
    .from("leads")
    .select("email, name")
    .eq("id", leadId)
    .maybeSingle();
  const leadEmail = (leadRow as { email: string | null } | null)?.email;
  const leadName = (leadRow as { name: string | null } | null)?.name;

  const { data: oferta, error: insertErr } = await sb
    .from("ofertas_enviadas")
    .insert({
      lead_id: leadId,
      teacher_id: teacherId,
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
    console.error("[send-offer] insert failed:", insertErr);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const ofertaId = (oferta as { id: string }).id;

  // Link corto en nuestro dominio — la Checkout Session real se crea
  // cuando el lead visita el link (ver lib/enrollment-checkout.ts).
  const checkoutUrl = buildPagoUrl(ofertaId);

  // Guardar la URL en la oferta (migración 152) — alimenta el botón
  // "Copiar enlace" de la ficha del trial (petición Jonathan 2026-11-07).
  await sb.from("ofertas_enviadas").update({ checkout_url: checkoutUrl }).eq("id", ofertaId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "system",
    content: `📦 Oferta enviada: ${packLabel} · ${(importe_cents / 100).toLocaleString("es-ES")} € · ${clases_totales} clases${clases_por_mes ? ` (${clases_por_mes}/mes)` : ""}`,
    metadata: {
      kind: "offer_sent",
      oferta_id: ofertaId,
      teacher_id: teacherId,
      pack_id: packId,
      category,
    },
  });

  const attendedOpts: AttendedOptions = {
    packId: packId as AttendedOptions["packId"],
    paymentType,
    objective: "",
    fullUrl: checkoutUrl,
    ...(packLabel ? { packLabel } : {}),
    metaLabel,
    ritmoLabel,
    fechaLlegada,
    isOneTime,
  };

  await markTrialAttendedAwaitingConversion(leadId, attendedOpts);

  await registerContact({
    leadId,
    actor: await actorFromPanelUser(user),
    actionType: "enviar_enlace",
    channel: "whatsapp",
    note: `Oferta: ${packLabel} · ${(importe_cents / 100).toLocaleString("es-ES")} €`,
  });

  return NextResponse.json({ ok: true, ofertaId, checkoutUrl });
}
