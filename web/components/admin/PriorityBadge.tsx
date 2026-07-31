/**
 * Insignias de prioridad para el CRM (Gelfis 2026-07-28).
 *
 *  - 💰 VIP    → lead pagó los 10€ (reserva_prioritaria=true).
 *  - 🔥 URGENTE → lead con priority_deadline='concrete' (fecha
 *                  concreta: examen, entrevista, trámite).
 *  - 💎 PAID-INTENT → llegó por /meta-ads-paid y arrancó el flow
 *                  Stripe pero aún no ha pagado (deposit_intent_at
 *                  seteado pero reserva_prioritaria=false).
 *
 * Se rendericen en `/admin/funnel` (tabla + cards mobile), en
 * `/admin/leads/[id]` (ficha), en `/profesor/clasedeprueba`
 * (TrialHubCard) y en `/closer/leads/[id]`.
 */

export type PriorityFlags = {
  reservaPrioritaria?: boolean | null;
  priorityDeadline?:   string | null;
  depositIntentAt?:    string | null;
};

export function PriorityBadges({ flags }: { flags: PriorityFlags }) {
  const isVip     = flags.reservaPrioritaria === true;
  const isUrgent  = flags.priorityDeadline === "concrete";
  const isPaidIntent = !isVip && !!flags.depositIntentAt;

  if (!isVip && !isUrgent && !isPaidIntent) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {isVip && (
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider
                     bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-900 border-amber-300 shadow-sm"
          title="Reserva Prioritaria pagada (10€)"
        >
          💰 VIP
        </span>
      )}
      {isUrgent && (
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
                     bg-red-50 text-red-700 border-red-200"
          title="Lead con fecha concreta (examen/entrevista/trámite)"
        >
          🔥 Urgente
        </span>
      )}
      {isPaidIntent && (
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
                     bg-slate-100 text-slate-700 border-slate-300"
          title="Empezó Meta Ads Paid pero no pagó el depósito"
        >
          💎 Pending 10€
        </span>
      )}
    </span>
  );
}

/**
 * Row background helper — devuelve una class util para destacar la
 * fila entera en las tablas del CRM (dorada para VIP, roja tenue
 * para urgente). Combínalo con la row de la tabla.
 */
export function priorityRowClass(flags: PriorityFlags): string {
  if (flags.reservaPrioritaria === true) return "bg-amber-50/40 hover:bg-amber-100/40";
  if (flags.priorityDeadline === "concrete") return "bg-red-50/25 hover:bg-red-100/30";
  return "";
}

// ────────────────────── Resumen legible ──────────────────────
/**
 * Resumen de un vistazo — combina qualification_answers en un string
 * corto para mostrar en la ficha del lead (admin / profesor / closer).
 */
export type QualificationAnswers = {
  goal?:     string | null;
  level?:    string | null;
  deadline?: string | null;
  pain?:     string | null;
};

const GOAL_LABEL: Record<string, string> = {
  job: "mejor trabajo", ausbildung: "Ausbildung", citizenship: "nacionalidad",
  daily_life: "día a día", moving: "mudanza",
};
const LEVEL_LABEL: Record<string, string> = {
  zero: "A0", basic: "A1-A2", intermediate: "B1", advanced: "B2+", unknown: "?",
};
const DEADLINE_LABEL: Record<string, string> = {
  concrete: "🔥 fecha concreta", "6m": "6 meses", year: "este año", no_rush: "sin prisa",
};
const PAIN_LABEL: Record<string, string> = {
  silent: "se queda callado", dependent: "depende de otros", job_lost: "pierde trabajo",
  tried_before: "intentó antes", no_progress: "no avanza",
};

export function summarizeQualification(q: QualificationAnswers | null | undefined): string | null {
  if (!q || (!q.goal && !q.level && !q.deadline && !q.pain)) return null;
  const parts: string[] = [];
  if (q.goal)     parts.push(`Meta: ${GOAL_LABEL[q.goal] ?? q.goal}`);
  if (q.level)    parts.push(`Nivel: ${LEVEL_LABEL[q.level] ?? q.level}`);
  if (q.deadline) parts.push(`Plazo: ${DEADLINE_LABEL[q.deadline] ?? q.deadline}`);
  if (q.pain)     parts.push(`Dolor: ${PAIN_LABEL[q.pain] ?? q.pain}`);
  return parts.join(" · ");
}
