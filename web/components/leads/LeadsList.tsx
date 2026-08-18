"use client";

/**
 * Lista de leads COMPARTIDA entre closer y profesor (Gelfis 2026-08-17):
 * "tiene que ser la misma página, con la misma lógica — cada uno con
 * sus leads correspondientes".
 *
 * Misma UI y reglas para ambos roles:
 *   · Orden: semáforo rojo → amarillo → verde; dentro de cada color el
 *     último contacto más viejo primero (sin contacto = arriba).
 *   · Borde izquierdo + punto con el color del estado, badge de causa
 *     en rojos, cita pendiente (sesión/clase) en ámbar.
 *   · Columna "Último contacto" + popup "Notas" (queda en la ficha y
 *     cuenta como contacto → actualiza último contacto y semáforo).
 *   · Filtros de asistencia, buscador y tasa de cierre.
 *
 * Lo único que cambia por rol: a dónde lleva la fila (su ficha), el
 * endpoint de notas y el label del chip pendiente.
 */

import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { PriorityBadges } from "@/components/admin/PriorityBadge";
import { fmtRelative, fmtTrialDate } from "@/lib/closer-constants";

const GOAL_LABEL: Record<string, string> = {
  work: "trabajo", study: "estudios", partner: "pareja",
  job: "mejor trabajo", ausbildung: "Ausbildung", citizenship: "nacionalidad",
  daily_life: "día a día", moving: "mudanza",
};
const LEVEL_LABEL: Record<string, string> = {
  zero: "A0", basic: "A1-A2", intermediate: "B1", advanced: "B2+", unknown: "?",
};
const DEADLINE_LABEL: Record<string, string> = {
  concrete: "fecha concreta", "6m": "6 meses", year: "este año", no_rush: "sin prisa",
};
const DEADLINE_CLS: Record<string, string> = {
  concrete: "text-red-600 dark:text-red-400 font-semibold",
  "6m": "text-amber-600 dark:text-amber-400",
  year: "text-slate-600 dark:text-slate-300",
  no_rush: "text-slate-400 dark:text-slate-500",
};

export type LeadItem = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  status: string;
  estado_cierre: string | null;
  created_at: string;
  german_level: string | null;
  qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
  reserva_prioritaria: boolean | null;
  priority_deadline: string | null;
  deposit_intent_at: string | null;
  trial_scheduled_at: string | null;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
  sesion_plan_at: string | null;
};

/** Cita pendiente del lead (sesión o clase sin resultado registrado). */
function citaPendiente(l: LeadItem): { label: string; at: string } | null {
  if (l.trial_attended_at || l.trial_absent_at) return null;
  if (l.sesion_plan_at) return { label: "📋 Sesión", at: l.sesion_plan_at };
  if (l.trial_scheduled_at) return { label: "🗓 Clase", at: l.trial_scheduled_at };
  return null;
}

export type LeadSemaforo = {
  color: "rojo" | "amarillo" | "verde";
  badge: string;
  detalle: string;
  /** true = lead activo SIN próxima jugada (limbo) — verde por omisión,
   *  no por mérito. Se pinta gris "⚠️ Sin jugada" para no disfrazarlo. */
  limbo?: boolean;
};

const SEM_BORDER: Record<LeadSemaforo["color"], string> = {
  rojo: "border-l-red-500",
  amarillo: "border-l-amber-400",
  verde: "border-l-emerald-500",
};
const SEM_DOT: Record<LeadSemaforo["color"], string> = {
  rojo: "bg-red-500",
  amarillo: "bg-amber-400",
  verde: "bg-emerald-500",
};

const semBorder = (s: LeadSemaforo) => (s.limbo ? "border-l-slate-400" : SEM_BORDER[s.color]);
const semDot    = (s: LeadSemaforo) => (s.limbo ? "bg-slate-400" : SEM_DOT[s.color]);

export type LastContactInfo = {
  label: string;
  at: string | null;
};

type Role = "closer" | "profesor";

const ROLE_CONFIG: Record<Role, {
  fichaBase: string;
  pendienteChip: string;
  emptyMsg: string;
  saveNote: (leadId: string, text: string) => { url: string; body: unknown };
}> = {
  closer: {
    fichaBase: "/closer/leads",
    pendienteChip: "🗓 Sesión pendiente",
    emptyMsg: "Aún no tienes leads asignados.",
    saveNote: (leadId, text) => ({
      url: `/api/closer/leads/${leadId}/action`,
      body: { tipo: "nota", contenido: text },
    }),
  },
  profesor: {
    fichaBase: "/profesor/leads",
    pendienteChip: "🗓 Clase pendiente",
    emptyMsg: "Aún no tienes leads con clase de prueba agendada.",
    saveNote: (leadId, text) => ({
      url: `/api/teacher/leads/${leadId}/note`,
      body: { content: text },
    }),
  },
};

type Props = {
  role: Role;
  leads: LeadItem[];
  semaforoByLead?: Record<string, LeadSemaforo>;
  lastContactByLead?: Record<string, LastContactInfo>;
};

const COLOR_RANK: Record<LeadSemaforo["color"], number> = { rojo: 0, amarillo: 1, verde: 2 };

type AttFilter = "todos" | "pendiente" | "asistio" | "no_asistio";

function attOf(l: { trial_attended_at: string | null; trial_absent_at: string | null }): Exclude<AttFilter, "todos"> {
  return l.trial_attended_at ? "asistio" : l.trial_absent_at ? "no_asistio" : "pendiente";
}

export function LeadsList({ role, leads, semaforoByLead = {}, lastContactByLead = {} }: Props) {
  const cfg = ROLE_CONFIG[role];
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [attFilter, setAttFilter] = useState<AttFilter>("todos");
  // Popup "Notas" — la nota queda en la ficha del lead y cuenta como
  // último contacto (apaga rojos 💬 del semáforo si aplica).
  const [notasLead, setNotasLead] = useState<LeadItem | null>(null);
  const [notaText, setNotaText] = useState("");
  const [notaSaving, setNotaSaving] = useState(false);
  const [notaError, setNotaError] = useState<string | null>(null);

  async function guardarNota() {
    if (!notasLead || notaText.trim().length < 5) {
      setNotaError("La nota necesita al menos 5 caracteres.");
      return;
    }
    setNotaSaving(true);
    setNotaError(null);
    try {
      const { url, body } = cfg.saveNote(notasLead.id, notaText.trim());
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setNotaError("No se pudo guardar. Inténtalo de nuevo.");
        return;
      }
      setNotasLead(null);
      setNotaText("");
      router.refresh();
    } finally {
      setNotaSaving(false);
    }
  }

  const counts = useMemo(() => {
    const c = { pendiente: 0, asistio: 0, no_asistio: 0 };
    for (const l of leads) c[attOf(l)]++;
    return c;
  }, [leads]);

  // Orden: semáforo rojo → amarillo → verde; dentro de cada color el
  // último contacto MÁS VIEJO primero (sin contacto arriba de todo).
  const filtered = useMemo(() => {
    let result = attFilter === "todos" ? leads : leads.filter((l) => attOf(l) === attFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((l) =>
        (l.name ?? "").toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.whatsapp_normalized ?? "").includes(q)
      );
    }
    // Rank: rojo 0 · amarillo 1 · limbo 2 (sin jugada — antes que los
    // verdes reales) · verde 3 · sin semáforo 4.
    const rank = (id: string) => {
      const s = semaforoByLead[id];
      if (!s) return 4;
      if (s.limbo) return 2;
      return s.color === "verde" ? 3 : COLOR_RANK[s.color];
    };
    return [...result].sort((a, b) => {
      const ra = rank(a.id);
      const rb = rank(b.id);
      if (ra !== rb) return ra - rb;
      const ca = lastContactByLead[a.id]?.at ?? "";
      const cb = lastContactByLead[b.id]?.at ?? "";
      if (ca !== cb) return ca < cb ? -1 : 1;   // "" (nunca) primero
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [leads, search, attFilter, semaforoByLead, lastContactByLead]);

  const CHIPS: Array<{ key: AttFilter; label: string; activeCls: string }> = [
    { key: "todos",      label: `Todos (${leads.length})`,                      activeCls: "bg-brand-600 text-white border-brand-600" },
    { key: "pendiente",  label: `${cfg.pendienteChip} (${counts.pendiente})`,   activeCls: "bg-blue-600 text-white border-blue-600" },
    { key: "asistio",    label: `✓ Asistió (${counts.asistio})`,                activeCls: "bg-emerald-600 text-white border-emerald-600" },
    { key: "no_asistio", label: `✗ No asistió (${counts.no_asistio})`,          activeCls: "bg-red-600 text-white border-red-600" },
  ];

  // Tasa de cierre: convertidos ÷ asistieron (solo cuentan los que
  // SÍ asistieron — decisión Gelfis 2026-08-13).
  const asistieron = useMemo(() => leads.filter((l) => !!l.trial_attended_at), [leads]);
  const convertidos = useMemo(
    () => asistieron.filter((l) => l.estado_cierre === "convertido" || l.status === "converted"),
    [asistieron],
  );
  const closeRate = asistieron.length > 0 ? (convertidos.length / asistieron.length) * 100 : null;

  return (
    <div className="space-y-4">
      {/* Tasa de cierre */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/25 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-500/10 dark:to-slate-900 px-4 py-3 flex items-baseline gap-3 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          🎯 Tu tasa de cierre
        </span>
        {closeRate !== null ? (
          <>
            <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-50 tabular-nums">
              {closeRate.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {convertidos.length} de {asistieron.length} asistentes se inscribieron
            </span>
          </>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Aún sin asistentes — se calcula sobre los leads que sí asistieron
          </span>
        )}
      </div>
      {/* Filtros de asistencia + buscador */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap flex-1">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setAttFilter(c.key)}
              className={`text-xs font-medium rounded-full border px-3 py-1.5 transition-colors ${
                attFilter === c.key
                  ? c.activeCls
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre, email o WA..."
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-400 dark:focus:border-brand-500 w-full sm:w-64"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          {search ? "Sin resultados para esta búsqueda." : cfg.emptyMsg}
        </div>
      ) : (
        <>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  <th className="text-left py-2 px-3">Lead</th>
                  <th className="text-left py-2 px-3">Último contacto</th>
                  <th className="text-left py-2 px-3">Contacto</th>
                  <th className="text-left py-2 px-3">Meta</th>
                  <th className="text-left py-2 px-3">Nivel</th>
                  <th className="text-left py-2 px-3">Plazo</th>
                  <th className="text-left py-2 px-3">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((l) => {
                  const attState = l.trial_attended_at ? "attended"
                    : l.trial_absent_at ? "absent" : null;
                  const waDigits = l.whatsapp_normalized?.replace(/\D/g, "") ?? "";
                  const prioFlags = {
                    reservaPrioritaria: l.reserva_prioritaria,
                    priorityDeadline: l.priority_deadline,
                    depositIntentAt: l.deposit_intent_at,
                  };
                  const sem = semaforoByLead[l.id];
                  const q = l.qualification_answers;
                  const goalRaw = q?.goal;
                  const levelRaw = q?.level;
                  const deadlineRaw = q?.deadline;

                  return (
                    <tr
                      key={l.id}
                      onClick={() => router.push(`${cfg.fichaBase}/${l.id}`)}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 cursor-pointer transition-colors ${attState === "absent" ? "bg-slate-100/70 dark:bg-slate-800/40" : ""}`}
                    >
                      <td className={`py-2.5 px-3 border-l-4 ${sem ? semBorder(sem) : "border-l-transparent"}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {sem && (
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${semDot(sem)}`} title={sem.detalle} />
                          )}
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {l.name ?? "(sin nombre)"}
                          </span>
                        </span>
                        <div className="mt-0.5"><PriorityBadges flags={prioFlags} /></div>
                        <div className="text-[10.5px] text-slate-400 dark:text-slate-500">{fmtRelative(l.created_at)}</div>
                        {sem?.color === "rojo" && (
                          <div className="text-[10.5px] font-bold text-red-600 dark:text-red-400 mt-0.5" title={sem.detalle}>
                            {sem.badge}
                          </div>
                        )}
                        {sem?.limbo && (
                          <div className="text-[10.5px] font-bold text-slate-500 dark:text-slate-400 mt-0.5" title={sem.detalle}>
                            ⚠️ Sin jugada
                          </div>
                        )}
                        {citaPendiente(l) && (
                          <div className="text-[10.5px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5 whitespace-nowrap">
                            {citaPendiente(l)!.label}: {fmtTrialDate(citaPendiente(l)!.at)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-[12px] whitespace-nowrap ${lastContactByLead[l.id]?.at ? "text-slate-600 dark:text-slate-300" : "text-red-500 dark:text-red-400 font-semibold"}`}>
                          {lastContactByLead[l.id]?.label ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-[12px] text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
                          {l.email ?? "—"}
                        </div>
                        {waDigits ? (
                          <a
                            href={`https://wa.me/${waDigits}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-mono inline-flex items-center gap-1"
                          >
                            💬 {l.whatsapp_normalized}
                          </a>
                        ) : (
                          <div className="text-[11px] text-slate-300 dark:text-slate-600 font-mono">—</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {goalRaw ? (
                          <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 capitalize">
                            {GOAL_LABEL[goalRaw] ?? goalRaw}
                          </span>
                        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        {(levelRaw || l.german_level) ? (
                          <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/25 px-2 py-0.5 text-[13px] font-bold text-sky-700 dark:text-sky-300 tabular-nums">
                            {LEVEL_LABEL[levelRaw ?? ""] ?? l.german_level ?? levelRaw}
                          </span>
                        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        {deadlineRaw ? (
                          <span className={`text-[13px] font-medium ${DEADLINE_CLS[deadlineRaw] ?? "text-slate-600 dark:text-slate-300"}`}>
                            {DEADLINE_LABEL[deadlineRaw] ?? deadlineRaw}
                          </span>
                        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setNotasLead(l); }}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          📝 Notas
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((l) => {
              const attState = l.trial_attended_at ? "attended"
                : l.trial_absent_at ? "absent" : null;
              const waDigits = l.whatsapp_normalized?.replace(/\D/g, "") ?? "";
              const prioFlags = {
                reservaPrioritaria: l.reserva_prioritaria,
                priorityDeadline: l.priority_deadline,
                depositIntentAt: l.deposit_intent_at,
              };
              const sem = semaforoByLead[l.id];
              const q = l.qualification_answers;
              const goalRaw = q?.goal;
              const levelRaw = q?.level;
              const deadlineRaw = q?.deadline;

              return (
                <div
                  key={l.id}
                  onClick={() => router.push(`${cfg.fichaBase}/${l.id}`)}
                  className={`rounded-2xl border border-l-4 border-slate-200 dark:border-slate-800 p-3 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${sem ? semBorder(sem) : "border-l-transparent"} ${attState === "absent" ? "bg-slate-100/70 dark:bg-slate-800/40" : "bg-white dark:bg-slate-900"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5">
                        {sem && (
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${semDot(sem)}`} title={sem.detalle} />
                        )}
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {l.name ?? "(sin nombre)"}
                        </span>
                      </span>
                      <div className="mt-0.5"><PriorityBadges flags={prioFlags} /></div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">{fmtRelative(l.created_at)}</div>
                      {sem?.color === "rojo" && (
                        <div className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-0.5">{sem.badge}</div>
                      )}
                      {sem?.limbo && (
                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">⚠️ Sin jugada</div>
                      )}
                      <div className={`text-[11px] mt-0.5 ${lastContactByLead[l.id]?.at ? "text-slate-500 dark:text-slate-400" : "text-red-500 dark:text-red-400 font-semibold"}`}>
                        Último contacto: {lastContactByLead[l.id]?.label ?? "—"}
                      </div>
                      {citaPendiente(l) && (
                        <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                          {citaPendiente(l)!.label}: {fmtTrialDate(citaPendiente(l)!.at)}
                        </div>
                      )}
                    </div>
                    {(levelRaw || l.german_level) && (
                      <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/25 px-2 py-0.5 text-[12px] font-bold text-sky-700 dark:text-sky-300 shrink-0">
                        {LEVEL_LABEL[levelRaw ?? ""] ?? l.german_level ?? levelRaw}
                      </span>
                    )}
                  </div>

                  {/* Meta + Plazo row */}
                  <div className="mt-1.5 flex items-center gap-3 text-[12px]">
                    {goalRaw && (
                      <span className="font-medium text-slate-700 dark:text-slate-200 capitalize">
                        {GOAL_LABEL[goalRaw] ?? goalRaw}
                      </span>
                    )}
                    {deadlineRaw && (
                      <span className={`${DEADLINE_CLS[deadlineRaw] ?? "text-slate-600 dark:text-slate-300"}`}>
                        {DEADLINE_LABEL[deadlineRaw] ?? deadlineRaw}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
                    {l.email ?? "—"}
                  </div>
                  {waDigits ? (
                    <a
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400 hover:underline font-mono"
                    >
                      💬 {l.whatsapp_normalized}
                    </a>
                  ) : null}

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setNotasLead(l); }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      📝 Notas
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Popup Notas — nota rápida que queda en el lead y cuenta como
          último contacto */}
      {notasLead && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !notaSaving && setNotasLead(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
              📝 Nota sobre {notasLead.name ?? "el lead"}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
              Queda guardada en su ficha y actualiza el último contacto.
            </p>
            <textarea
              autoFocus
              value={notaText}
              onChange={(e) => setNotaText(e.target.value)}
              rows={4}
              placeholder="Qué hablaron, qué quedó pendiente… (mín. 5 caracteres)"
              className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) guardarNota();
              }}
            />
            {notaError && <div className="mt-2 text-[12px] text-red-500">{notaError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={notaSaving}
                onClick={() => { setNotasLead(null); setNotaText(""); setNotaError(null); }}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={notaSaving || notaText.trim().length < 5}
                onClick={guardarNota}
                className="rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition-colors"
              >
                {notaSaving ? "Guardando…" : "Guardar nota"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
