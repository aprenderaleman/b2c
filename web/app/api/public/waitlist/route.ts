import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveProfe } from "@/lib/profes";

/**
 * POST /api/public/waitlist — lista de espera del embudo de clase de
 * prueba (Gelfis 2026-11-24).
 *
 * Desde que las clases de prueba solo se ofrecen a 10 días vista
 * (lib/trial-slots.ts → TRIAL_HORIZON_DAYS), puede que el embudo no
 * tenga ningún hueco. En vez de una pantalla muerta, el lead deja
 * nombre + WhatsApp (+ email opcional) y queda en el CRM:
 *
 *   - status = 'needs_human' (sale en "Atención humana" del dashboard;
 *     no dispara ninguna cadena automática). Nunca degradamos a un
 *     lead que ya tiene cita o ya es alumno.
 *   - meta.waitlist = { at, landing_intent, profe } — marca consultable
 *     para contar la demanda que se queda sin atender.
 *   - lead_timeline: nota "Lista de espera" para el setter/Gelfis.
 *
 * NO envía ningún mensaje al lead (regla: nada automático sin OK).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name:           z.string().trim().min(2).max(120),
  email:          z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  whatsapp_e164:  z.string().trim().regex(/^\+\d{7,15}$/),
  whatsapp_raw:   z.string().trim().max(40).nullable().optional(),
  landing_intent: z.string().trim().max(40).nullable().optional(),
  profe:          z.string().trim().max(20).nullable().optional(),
  gclid:          z.string().trim().max(200).nullable().optional(),
  gbraid:         z.string().trim().max(200).nullable().optional(),
  wbraid:         z.string().trim().max(200).nullable().optional(),
  fbclid:         z.string().trim().max(500).nullable().optional(),
  utm_source:     z.string().trim().max(120).nullable().optional(),
  utm_medium:     z.string().trim().max(120).nullable().optional(),
  utm_campaign:   z.string().trim().max(200).nullable().optional(),
  utm_term:       z.string().trim().max(200).nullable().optional(),
  utm_content:    z.string().trim().max(200).nullable().optional(),
}).passthrough();

// Estados que NO se tocan: ya tiene cita, está reagendando o ya pagó.
const KEEP_STATUS = new Set([
  "trial_scheduled", "trial_reminded", "rescheduling", "converted", "registered",
]);

export async function POST(req: Request) {
  let b: z.infer<typeof Body>;
  try {
    b = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body", message: "Revisa tu nombre y tu WhatsApp." }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const profeSlug = b.profe ? (resolveProfe(b.profe)?.slug ?? "generico") : null;
  const waitlist = { at: now, landing_intent: b.landing_intent ?? null, profe: profeSlug };

  const orFilters = [`whatsapp_normalized.eq.${b.whatsapp_e164}`];
  if (b.email) orFilters.push(`email.eq.${b.email}`);
  const { data: existing } = await sb
    .from("leads")
    .select("id, status, meta, email, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_intent, profe")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId: string;
  if (existing) {
    const ex = existing as {
      id: string; status: string; meta: Record<string, unknown> | null; email: string | null;
      utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
      utm_term: string | null; utm_content: string | null; landing_intent: string | null; profe: string | null;
    };
    leadId = ex.id;
    await sb.from("leads").update({
      ...(KEEP_STATUS.has(ex.status) ? {} : { status: "needs_human", next_contact_date: now }),
      email:          ex.email ?? b.email ?? null,
      landing_intent: ex.landing_intent ?? b.landing_intent ?? null,
      utm_source:     ex.utm_source   ?? b.utm_source   ?? null,
      utm_medium:     ex.utm_medium   ?? b.utm_medium   ?? null,
      utm_campaign:   ex.utm_campaign ?? b.utm_campaign ?? null,
      utm_term:       ex.utm_term     ?? b.utm_term     ?? null,
      utm_content:    ex.utm_content  ?? b.utm_content  ?? null,
      ...(ex.profe == null && profeSlug ? { profe: profeSlug } : {}),
      meta: { ...(ex.meta ?? {}), waitlist },
    }).eq("id", leadId);
  } else {
    const { data: created, error } = await sb.from("leads").insert({
      name:                b.name,
      email:               b.email ?? null,
      whatsapp_normalized: b.whatsapp_e164,
      whatsapp_raw:        b.whatsapp_raw ?? null,
      language:            "es",
      status:              "needs_human",
      next_contact_date:   now,
      landing_intent:      b.landing_intent ?? null,
      motivo_inicial:      b.landing_intent ? "direct" : null,
      gclid:               b.gclid   ?? null,
      gbraid:              b.gbraid  ?? null,
      wbraid:              b.wbraid  ?? null,
      fbclid:              b.fbclid  ?? null,
      utm_source:          b.utm_source   ?? null,
      utm_medium:          b.utm_medium   ?? null,
      utm_campaign:        b.utm_campaign ?? null,
      utm_term:            b.utm_term     ?? null,
      utm_content:         b.utm_content  ?? null,
      profe:               profeSlug,
      gdpr_accepted:       true,
      gdpr_accepted_at:    now,
      source:              "funnel_waitlist",
      meta:                { waitlist },
    }).select("id").single();
    if (error || !created) {
      console.error("[waitlist] insert failed:", error);
      return NextResponse.json({ ok: false, error: "lead_create_failed", message: "No pudimos guardar tus datos. Inténtalo de nuevo." }, { status: 500 });
    }
    leadId = (created as { id: string }).id;
  }

  await sb.from("lead_timeline").insert({
    lead_id:  leadId,
    type:     "agent_note",
    author:   "system",
    content:  `⏳ Lista de espera: no había huecos de clase de prueba en los próximos 10 días` +
              (profeSlug ? ` (landing de ${profeSlug})` : "") +
              `. Avisarle cuando se abra un horario.`,
    metadata: { kind: "trial_waitlist", ...waitlist },
  });

  return NextResponse.json({ ok: true, leadId });
}
