/**
 * Buscador global de leads para el setter (Gelfis 2026-11-10): acceso a
 * TODOS los leads, buscando en todos los datos que tenemos (nombre,
 * email, teléfono, meta, motivo, nivel). El teléfono matchea por
 * subcadena de dígitos — no hace falta el número completo.
 */

import { supabaseAdmin } from "./supabase";

const T = (iso: string) => new Date(iso).getTime();

export type SetterSearchRow = {
  leadId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  goal: string | null;
  germanLevel: string | null;
  status: string;
  citaFutura: string | null;
  createdAt: string;
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  in_conversation: "En conversación",
  needs_human: "Atención humana",
  trial_scheduled: "Cita agendada",
  trial_confirmed: "Cita confirmada",
  trial_attended: "Asistió",
  trial_absent: "No asistió",
  rescheduling: "Reagendando",
  converted: "Convertido 💰",
  lost: "Descartado",
  en_reactivacion: "En reactivación",
  student_active: "Alumno activo",
};

export async function searchLeadsForSetter(q: string): Promise<SetterSearchRow[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const sb = supabaseAdmin();
  const safe = query.replace(/[%,()]/g, "");
  const digits = query.replace(/\D/g, "");

  // Busca en los campos de TEXTO del lead; el teléfono también por
  // subcadena de SOLO dígitos (p. ej. "1675" encuentra +4915167…).
  // OJO: goal y german_level son ENUMS en Postgres — ilike sobre ellos
  // revienta la query; para esos se usa match exacto si el término
  // coincide con un valor del enum.
  const ors = [
    `name.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `whatsapp_normalized.ilike.%${safe}%`,
    `whatsapp_raw.ilike.%${safe}%`,
    `motivo_inicial.ilike.%${safe}%`,
  ];
  const GOALS = ["work", "studies", "visa", "travel", "family", "already_in_dach"];
  const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
  if (GOALS.includes(safe.toLowerCase())) ors.push(`goal.eq.${safe.toLowerCase()}`);
  const levelUp = safe.toUpperCase();
  if (LEVELS.includes(levelUp)) ors.push(`german_level.eq.${levelUp}`);
  if (digits.length >= 3 && digits !== safe) {
    ors.push(`whatsapp_normalized.ilike.%${digits}%`);
    ors.push(`whatsapp_raw.ilike.%${digits}%`);
  }

  const { data } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, whatsapp_raw, goal, german_level, status, trial_scheduled_at, sesion_plan_at, created_at")
    .or(ors.join(","))
    .order("created_at", { ascending: false })
    .limit(50);

  const now = Date.now();
  return ((data ?? []) as Array<{
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; whatsapp_raw: string | null;
    goal: string | null; german_level: string | null; status: string;
    trial_scheduled_at: string | null; sesion_plan_at: string | null; created_at: string;
  }>).map((l) => ({
    leadId: l.id,
    name: l.name,
    phone: l.whatsapp_normalized ?? l.whatsapp_raw,
    email: l.email,
    goal: l.goal,
    germanLevel: l.german_level,
    status: l.status,
    citaFutura:
      (l.trial_scheduled_at && T(l.trial_scheduled_at) > now && l.trial_scheduled_at) ||
      (l.sesion_plan_at && T(l.sesion_plan_at) > now && l.sesion_plan_at) || null,
    createdAt: l.created_at,
  }));
}
