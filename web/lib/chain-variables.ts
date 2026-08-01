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
  const d = new Date(new Date(startedAt).getTime() + 48 * 3_600_000);
  const day = DAY_NAMES_ES[d.getDay()];
  return `el ${day}`;
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

  // Teacher name from latest trial class
  let profeName = "tu profesor/a";
  const { data: classRow } = await sb
    .from("classes")
    .select("teacher_id, users!classes_teacher_id_fkey(name)")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (classRow) {
    const teacher = (classRow as Record<string, unknown>).users as { name: string } | null;
    if (teacher?.name) profeName = firstName(teacher.name);
  }

  // Goal/meta resolution
  const metaLabel =
    (chainMeta.objective as string) ||
    (leadRow?.qualification_answers?.goal as string) ||
    (leadRow?.meta?.last_offered_objective as string) ||
    "tu nivel objetivo";

  // Ritmo name
  const packId = chainMeta.packId as string | undefined;
  const ritmo = packId ? RITMOS.find(r => r.id === packId) : null;
  const ritmoLabel =
    (chainMeta.packLabel as string) ||
    (ritmo ? `${ritmo.emoji} ${ritmo.name}` : "el ritmo recomendado");

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
    nueva_fecha: (chainMeta.nueva_fecha as string) || "",
    hora: (chainMeta.hora as string) || "",
  };
}

export function isBonusAlive(chainStartedAt: string): boolean {
  return new Date(chainStartedAt).getTime() + 48 * 3_600_000 > Date.now();
}
