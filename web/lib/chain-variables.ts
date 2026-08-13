/**
 * Resuelve las variables de personalización para las plantillas de cadenas.
 *
 * Variables disponibles:
 *   {nombre}              — primer nombre del lead
 *   {profe}               — nombre del profesor de la última trial
 *   {meta}                — objetivo del lead (A1-A2, B1, etc.)
 *   {ritmo_recomendado}   — nombre del ritmo recomendado
 *   {fecha_llegada}       — fecha estimada de logro (hoy + meses del ritmo)
 *   {dia_bonus}           — fecha de started_at + 48h, formateada "el jueves"
 *   {link_inscripciones}  — URL de la página de inscripciones
 *   {link_pago}           — URL Stripe personalizada (de chainMeta)
 *   {link_reagenda}       — URL para reagendar la trial
 *   {nueva_fecha}         — fecha reprogramada (de chainMeta)
 *   {hora}                — hora reprogramada (de chainMeta)
 *   {ritmo}               — nombre del ritmo seleccionado por el closer
 *   {precio_ritmo}        — precio mensual del ritmo (e.g. "240 €/mes")
 *   {link_agenda}         — URL para agendar una nueva clase
 *   {link_sesion}         — URL para agendar Sesión de Plan
 *   {link_hans}           — URL de Hans (tutor IA) — welcome_week
 *   {link_schule}         — URL de SCHULE (ejercicios) — welcome_week
 */

import { supabaseAdmin } from "./supabase";
import { RITMOS } from "./trial-packs";

const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://b2c.aprender-aleman.de";
const INSCRIPCIONES_URL = "https://www.aprender-aleman.de/inscripciones";

const DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function firstName(name: string | null): string {
  const n = (name ?? "").trim();
  return n.split(/\s+/)[0] || "";
}

function formatBonusDay(startedAt: string): string {
  // Devuelve solo el nombre del día ("jueves") — el copy pone el
  // artículo/preposición ("antes de {dia_bonus}"). Antes devolvía
  // "el jueves" y producía "antes del el jueves" (doble artículo).
  const d = new Date(new Date(startedAt).getTime() + 48 * 3_600_000);
  return DAY_NAMES_ES[d.getDay()];
}

function formatArrivalDate(monthsFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return `${MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function resolveGoalMonths(packId?: string, goalId?: string): number | null {
  if (!packId) return null;
  const ritmo = RITMOS.find(r => r.id === packId);
  if (!ritmo) return null;
  const goal = ritmo.goals.find(g => g.id === goalId || g.refId === goalId);
  return goal?.months ?? ritmo.goals[0]?.months ?? null;
}

export async function resolveChainVariables(
  leadId: string,
  chainMeta: Record<string, unknown>,
  startedAt: string,
): Promise<Record<string, string>> {
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("name, language, qualification_answers, meta")
    .eq("id", leadId)
    .maybeSingle();

  const leadRow = lead as {
    name: string | null;
    language: string | null;
    qualification_answers: Record<string, unknown> | null;
    meta: Record<string, unknown> | null;
  } | null;

  // Teacher name from latest trial class.
  // Fix Gelfis 2026-08-04: la columna es `full_name`, no `name`. Todos
  // los mensajes con {profe} caían al fallback "tu profesor/a".
  let profeName = "tu profe";
  const { data: classRow } = await sb
    .from("classes")
    .select("teacher_id, users!classes_teacher_id_fkey(full_name)")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (classRow) {
    const teacher = (classRow as Record<string, unknown>).users as { full_name: string } | null;
    if (teacher?.full_name) profeName = firstName(teacher.full_name);
  }

  // Goal/meta resolution.
  // Fallback "aprender alemán": lee natural en "lograr {meta}" y "llegas a
  // {meta}". Antes era "tu nivel objetivo" → producía "tu tu nivel objetivo"
  // cuando el copy decía "tu {meta}".
  const metaLabel =
    (chainMeta.objective as string) ||
    (leadRow?.qualification_answers?.goal as string) ||
    (leadRow?.meta?.last_offered_objective as string) ||
    "aprender alemán";

  // Ritmo name.
  // Fallback "un ritmo personalizado": lee natural en "Tu plan recomendado:
  // {ritmo_recomendado}". Antes era "el ritmo recomendado" → duplicaba
  // "ritmo" en el copy.
  const packId = chainMeta.packId as string | undefined;
  const ritmo = packId ? RITMOS.find(r => r.id === packId) : null;
  const ritmoLabel =
    (chainMeta.packLabel as string) ||
    (ritmo ? `${ritmo.emoji} ${ritmo.name}` : "un ritmo personalizado");

  // Arrival date
  const goalId = (chainMeta.goal as string) || (chainMeta.goalId as string);
  const months = resolveGoalMonths(packId, goalId);
  const fechaLlegada = months ? formatArrivalDate(months) : "unos meses";

  const ritmoDirecto = (chainMeta.ritmo as string) || "";
  const precioRitmo = (chainMeta.precio_ritmo as string) || "";

  return {
    nombre: firstName(leadRow?.name ?? null) || "ahí",
    profe: profeName,
    meta: metaLabel,
    ritmo_recomendado: ritmoLabel,
    ritmo: ritmoDirecto || ritmoLabel,
    precio_ritmo: precioRitmo,
    fecha_llegada: fechaLlegada,
    dia_bonus: formatBonusDay(startedAt),
    link_inscripciones: `${INSCRIPCIONES_URL}?ref=${leadId}`,
    link_pago: (chainMeta.fullUrl as string) || `${INSCRIPCIONES_URL}?ref=${leadId}`,
    link_reagenda: `${PLATFORM_URL}/agendar/cuando?lead=${leadId}&from=chain`,
    link_agenda: `${PLATFORM_URL}/agendar/cuando?lead=${leadId}&from=closer`,
    // Reagendar una Sesión de Plan (funnel de closers, 2026-08-14)
    link_sesion: `${PLATFORM_URL}/sesion-plan`,
    // welcome_week — activación primera semana (Gelfis 2026-08-14)
    link_hans:   process.env.HANS_URL   || "https://hans.aprender-aleman.de",
    link_schule: process.env.SCHULE_URL || "https://schule.aprender-aleman.de",
    nueva_fecha: (chainMeta.nueva_fecha as string) || "",
    hora: (chainMeta.hora as string) || "",
  };
}

/**
 * ¿Hay bono real activo? Cumple AUTHORING_RULES ("prohibida la escasez
 * inventada"): si `chainMeta.bonus_activo` no es explícitamente true,
 * NO se sirve la variante _bonus_vivo. La ventana temporal de 48h
 * antigua queda deprecada — el handler que arranca la chain debe
 * pasar `bonus_activo: true` cuando decidamos ofrecer el bono real.
 */
export function isBonusAlive(chainStartedAt: string, chainMeta?: Record<string, unknown>): boolean {
  return chainMeta?.bonus_activo === true;
}
