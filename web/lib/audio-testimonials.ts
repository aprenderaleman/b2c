/**
 * Testimonios en audio (WhatsApp voice notes) de estudiantes reales
 * (Gelfis 2026-08-14). No confundir con `lib/testimonials.ts` que son
 * cards de texto para la landing pública.
 *
 * Se envían como social proof en momentos donde el lead está evaluando:
 *   - chain2_link_sent step 4 (+48h enlace sin pagar) — Fase 1 activa
 *   - chain3_obj_* step 2 (objeción explícita) — Fase 2 futura
 *
 * Todos los audios siguen la misma estructura de 3 preguntas
 * (antes / cambio / consejo). No mencionamos duración porque varía.
 */

import { supabaseAdmin } from "./supabase";
import { signRecordingUrl } from "./r2";

export type AudioTestimonialRow = {
  id: string;
  nombre_estudiante: string;
  audio_url: string;
  audio_key: string;
  meta_tag: string;
  active: boolean;
};

/**
 * Selecciona el mejor testimonial para un lead:
 *   1. Match por meta_tag = leads.qualification_answers.goal
 *   2. Fallback a meta_tag='general'
 *   3. Fallback a cualquier active=true
 *
 * Excluye testimonios ya enviados a este lead (para no repetir).
 * Devuelve null si no hay testimonials disponibles (fallback = enviar
 * solo el texto de la cadena sin audio).
 */
export async function pickTestimonial(
  leadId: string,
): Promise<AudioTestimonialRow | null> {
  const sb = supabaseAdmin();

  const { data: leadRow } = await sb
    .from("leads")
    .select("qualification_answers, meta")
    .eq("id", leadId)
    .maybeSingle();
  const qa = (leadRow as { qualification_answers: Record<string, unknown> | null } | null)?.qualification_answers;
  const goal = (qa && typeof qa === "object" ? qa.goal : null) as string | null;

  const { data: sentRows } = await sb
    .from("testimonial_sends")
    .select("testimonial_id")
    .eq("lead_id", leadId);
  const sentIds = new Set((sentRows ?? []).map(r => (r as { testimonial_id: string }).testimonial_id));

  // Orden BD: created_at ASC → el testimonial subido primero se sirve
  // primero cuando hay empate por meta_tag. Sirve para "priorizar"
  // manualmente: sube en el orden en que quieres que salgan.
  const { data: pool } = await sb
    .from("testimonials")
    .select("id, nombre_estudiante, audio_url, audio_key, meta_tag, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });

  const rows = (pool ?? []) as (AudioTestimonialRow & { created_at: string })[];
  if (rows.length === 0) return null;

  const notSent = rows.filter(r => !sentIds.has(r.id));
  const available = notSent.length > 0 ? notSent : rows;

  // Tuple sort: (match-goal ASC, general ASC, created_at ASC preservado por stable sort)
  const priority = (r: AudioTestimonialRow): number => {
    if (goal && r.meta_tag === goal) return 0;
    if (r.meta_tag === "general") return 1;
    return 2;
  };
  available.sort((a, b) => priority(a) - priority(b));
  return available[0];
}

/**
 * Marca un testimonial como enviado a este lead (idempotente vía UNIQUE).
 */
export async function markTestimonialSent(
  testimonialId: string,
  leadId: string,
  chainType: string,
  chainStep: number,
): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("testimonial_sends").insert({
    testimonial_id: testimonialId,
    lead_id:        leadId,
    chain_type:     chainType,
    chain_step:     chainStep,
  }).select("id");
}

/**
 * Firma la URL del audio para envío. R2 es privado, Evolution necesita
 * URL accesible durante ~2 min (descarga y forward al lead). Firmamos
 * por 1h por seguridad.
 */
export async function signTestimonialUrl(t: AudioTestimonialRow): Promise<string> {
  return signRecordingUrl(t.audio_url, 3600);
}
