"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { SOURCE_META, fmtRelative, fmtTrialDate } from "@/lib/closer-constants";

export type CloserLead = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  status: string;
  estado_cierre: string;
  motivo_perdido: string | null;
  fecha_asignacion_closer: string | null;
  created_at: string;
  source: string | null;
  language: string | null;
  german_level: string | null;
  landing_intent: string | null;
  qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
  reserva_prioritaria: boolean | null;
  priority_deadline: string | null;
  deposit_intent_at: string | null;
  trial_scheduled_at: string | null;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
};

// 5 estados derivados (Gelfis 2026-08-03) — el closer nunca los edita a mano
const ESTADO_LABELS: Record<string, { label: string; cls: string }> = {
  sin_asignar:         { label: "Sin asignar",         cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30" },
  activo:              { label: "Activo",              cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  seguimiento_pactado: { label: "📅 Seguimiento pactado", cls: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30" },
  convertido:          { label: "Convertido",          cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
  en_reactivacion:     { label: "🌙 En reactivación",  cls: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30" },
  perdido:             { label: "Perdido",             cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" },
};

type Props = {
  leads: CloserLead[];
  teacherByLead: Record<string, string>;
};

type AttFilter = "todos" | "pendiente" | "asistio" | "no_asistio";

function attOf(l: { trial_attended_at: string | null; trial_absent_at: string | null }): Exclude<AttFilter, "todos"> {
  return l.trial_attended_at ? "asistio" : l.trial_absent_at ? "no_asistio" : "pendiente";
}

export function CloserLeadsList({ leads, teacherByLead }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [attFilter, setAttFilter] = useState<AttFilter>("todos");

  const counts = useMemo(() => {
    const c = { pendiente: 0, asistio: 0, no_asistio: 0 };
    for (const l of leads) c[attOf(l)]++;
    return c;
  }, [leads]);

  // Filtro por asistencia (Gelfis 2026-08-13) + buscador
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
    return result;
  }, [leads, search, attFilter]);

  const CHIPS: Array<{ key: AttFilter; label: string; activeCls: string }> = [
    { key: "todos",      label: `Todos (${leads.length})`,                  activeCls: "bg-brand-600 text-white border-brand-600" },
    { key: "pendiente",  label: `🗓 Sesión pendiente (${counts.pendiente})`, activeCls: "bg-blue-600 text-white border-blue-600" },
    { key: "asistio",    label: `✓ Asistió (${counts.asistio})`,            activeCls: "bg-emerald-600 text-white border-emerald-600" },
    { key: "no_asistio", label: `✗ No asistió (${counts.no_asistio})`,      activeCls: "bg-red-600 text-white border-red-600" },
  ];

  return (
    <div className="space-y-4">
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
          {search ? "Sin resultados para esta búsqueda." : "Aún no tienes leads asignados."}
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
                  <th className="text-left py-2 px-3">Contacto</th>
                  <th className="text-left py-2 px-3">Origen</th>
                  <th className="text-left py-2 px-3">Nivel</th>
                  <th className="text-left py-2 px-3">Trial</th>
                  <th className="text-left py-2 px-3">Cierre</th>
                  <th className="text-left py-2 px-3">Pipeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((l) => {
                  const meta = SOURCE_META[l.landing_intent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
                  const attState = l.trial_attended_at ? "attended"
                    : l.trial_absent_at ? "absent"
                    : l.trial_scheduled_at ? "scheduled" : null;
                  const waDigits = l.whatsapp_normalized?.replace(/\D/g, "") ?? "";
                  const prioFlags = {
                    reservaPrioritaria: l.reserva_prioritaria,
                    priorityDeadline: l.priority_deadline,
                    depositIntentAt: l.deposit_intent_at,
                  };
                  const qSummary = summarizeQualification(l.qualification_answers);
                  const est = ESTADO_LABELS[l.estado_cierre] ?? ESTADO_LABELS.sin_asignar;
                  const teacher = teacherByLead[l.id];

                  return (
                    <tr
                      key={l.id}
                      onClick={() => router.push(`/closer/leads/${l.id}`)}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-3">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {l.name ?? "(sin nombre)"}
                        </span>
                        <div className="mt-0.5"><PriorityBadges flags={prioFlags} /></div>
                        <div className="text-[10.5px] text-slate-400 dark:text-slate-500">{fmtRelative(l.created_at)}</div>
                        {qSummary && (
                          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-[260px] truncate" title={qSummary}>
                            {qSummary}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
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
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${meta.sourceCls}`}>
                          {meta.sourceIcon} {meta.sourceLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[12px] text-slate-600 dark:text-slate-300 font-mono">
                        {l.german_level ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-[12px]">
                        {l.trial_scheduled_at ? (
                          <>
                            <div className="text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                              {fmtTrialDate(l.trial_scheduled_at)}
                            </div>
                            {teacher && (
                              <div className="text-[10px] text-sky-600 dark:text-sky-400">👨‍🏫 {teacher}</div>
                            )}
                            {attState === "attended" && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">✓ asistió</span>}
                            {attState === "absent" && <span className="text-[10px] text-red-600 dark:text-red-400">✗ no asistió</span>}
                            {attState === "scheduled" && <span className="text-[10px] text-slate-400 dark:text-slate-500">pendiente</span>}
                          </>
                        ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${est.cls}`}>
                          {est.label}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge status={l.status} />
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
              const meta = SOURCE_META[l.landing_intent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
              const attState = l.trial_attended_at ? "attended"
                : l.trial_absent_at ? "absent"
                : l.trial_scheduled_at ? "scheduled" : null;
              const waDigits = l.whatsapp_normalized?.replace(/\D/g, "") ?? "";
              const prioFlags = {
                reservaPrioritaria: l.reserva_prioritaria,
                priorityDeadline: l.priority_deadline,
                depositIntentAt: l.deposit_intent_at,
              };
              const qSummary = summarizeQualification(l.qualification_answers);
              const est = ESTADO_LABELS[l.estado_cierre] ?? ESTADO_LABELS.sin_asignar;
              const teacher = teacherByLead[l.id];

              return (
                <div
                  key={l.id}
                  onClick={() => router.push(`/closer/leads/${l.id}`)}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {l.name ?? "(sin nombre)"}
                      </span>
                      <div className="mt-0.5"><PriorityBadges flags={prioFlags} /></div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">{fmtRelative(l.created_at)}</div>
                      {qSummary && (
                        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5 truncate" title={qSummary}>
                          {qSummary}
                        </div>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${meta.sourceCls} shrink-0`}>
                      {meta.sourceIcon} {meta.sourceLabel}
                    </span>
                  </div>

                  <div className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
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

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[11px]">
                      {l.trial_scheduled_at ? (
                        <>
                          <span className="text-slate-600 dark:text-slate-300">
                            🗓 {fmtTrialDate(l.trial_scheduled_at)}
                            {attState === "attended" && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">✓</span>}
                            {attState === "absent"   && <span className="ml-1.5 text-red-600 dark:text-red-400">✗</span>}
                            {attState === "scheduled" && <span className="ml-1.5 text-slate-400 dark:text-slate-500">…</span>}
                          </span>
                          {teacher && (
                            <div className="text-[10.5px] text-sky-600 dark:text-sky-400 mt-0.5">👨‍🏫 {teacher}</div>
                          )}
                        </>
                      ) : <span className="text-slate-300 dark:text-slate-600">sin trial</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${est.cls}`}>
                        {est.label}
                      </span>
                      <StatusBadge status={l.status} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
