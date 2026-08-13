"use client";

/**
 * "Mis leads" del profesor (Gelfis 2026-08-13) — misma lógica visual
 * que la lista del closer: leads que agendaron clase de prueba CON este
 * profe, con fecha del trial, asistencia, contacto directo y buscador.
 * Objetivo: que el profe contacte sus leads y convierta más estudiantes
 * (cobra comisión por conversión).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { SOURCE_META, fmtRelative, fmtTrialDate } from "@/lib/closer-constants";

export type TeacherLead = {
  leadId: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  status: string;
  germanLevel: string | null;
  landingIntent: string | null;
  createdAt: string;
  qualification: { goal?: string; level?: string; deadline?: string } | null;
  reservaPrioritaria: boolean | null;
  priorityDeadline: string | null;
  depositIntentAt: string | null;
  /** Fecha de la clase de prueba (la más reciente con este profe) */
  trialAt: string;
  trialStatus: string;
  attended: boolean;
  absent: boolean;
};

type AttFilter = "todos" | "pendiente" | "asistio" | "no_asistio";

function attOf(l: { attended: boolean; absent: boolean }): Exclude<AttFilter, "todos"> {
  return l.attended ? "asistio" : l.absent ? "no_asistio" : "pendiente";
}

export function TeacherLeadsList({ leads }: { leads: TeacherLead[] }) {
  const [search, setSearch] = useState("");
  const [attFilter, setAttFilter] = useState<AttFilter>("todos");

  const counts = useMemo(() => {
    const c = { pendiente: 0, asistio: 0, no_asistio: 0 };
    for (const l of leads) c[attOf(l)]++;
    return c;
  }, [leads]);

  const filtered = useMemo(() => {
    let result = attFilter === "todos" ? leads : leads.filter((l) => attOf(l) === attFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((l) =>
        (l.name ?? "").toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.whatsapp ?? "").includes(q)
      );
    }
    return result;
  }, [leads, search, attFilter]);

  const CHIPS: Array<{ key: AttFilter; label: string; activeCls: string }> = [
    { key: "todos",      label: `Todos (${leads.length})`,              activeCls: "bg-brand-600 text-white border-brand-600" },
    { key: "pendiente",  label: `🗓 Clase pendiente (${counts.pendiente})`, activeCls: "bg-blue-600 text-white border-blue-600" },
    { key: "asistio",    label: `✓ Asistió (${counts.asistio})`,        activeCls: "bg-emerald-600 text-white border-emerald-600" },
    { key: "no_asistio", label: `✗ No asistió (${counts.no_asistio})`,  activeCls: "bg-red-600 text-white border-red-600" },
  ];

  return (
    <div className="space-y-4">
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
          {search ? "Sin resultados para esta búsqueda." : "Aún no tienes leads con clase de prueba agendada."}
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
                  <th className="text-left py-2 px-3">Clase de prueba</th>
                  <th className="text-left py-2 px-3">Pipeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((l) => {
                  const meta = SOURCE_META[l.landingIntent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
                  const waDigits = l.whatsapp?.replace(/\D/g, "") ?? "";
                  const q = summarizeQualification(l.qualification);
                  return (
                    <tr key={l.leadId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3">
                        <div className="font-medium flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/profesor/leads/${l.leadId}`}
                            className="text-slate-800 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                          >
                            {l.name ?? "Lead"}
                          </Link>
                          <PriorityBadges flags={{
                            reservaPrioritaria: l.reservaPrioritaria,
                            priorityDeadline:   l.priorityDeadline,
                            depositIntentAt:    l.depositIntentAt,
                          }} />
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">{fmtRelative(l.createdAt)}</div>
                        {q && <div className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[220px] truncate">{q}</div>}
                      </td>
                      <td className="py-2 px-3 text-[12px]">
                        {l.email && <div className="text-slate-600 dark:text-slate-300 truncate max-w-[180px]">{l.email}</div>}
                        {waDigits ? (
                          <a
                            href={`https://wa.me/${waDigits}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-emerald-600 dark:text-emerald-400 hover:underline"
                          >
                            💬 {l.whatsapp}
                          </a>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">sin WA</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${meta.sourceCls}`}>
                          {meta.sourceIcon} {meta.sourceLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[12px] text-slate-600 dark:text-slate-300 font-mono">
                        {l.germanLevel ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-[12px]">
                        <div className="text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                          {fmtTrialDate(l.trialAt)}
                        </div>
                        {l.attended && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">✓ asistió</span>}
                        {l.absent && !l.attended && <span className="text-[10px] text-red-600 dark:text-red-400">✗ no asistió</span>}
                        {!l.attended && !l.absent && <span className="text-[10px] text-slate-400 dark:text-slate-500">pendiente</span>}
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
              const meta = SOURCE_META[l.landingIntent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
              const waDigits = l.whatsapp?.replace(/\D/g, "") ?? "";
              return (
                <div key={l.leadId} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                      <Link
                        href={`/profesor/leads/${l.leadId}`}
                        className="text-slate-900 dark:text-slate-50 hover:text-brand-600 dark:hover:text-brand-400 hover:underline"
                      >
                        {l.name ?? "Lead"}
                      </Link>
                      <PriorityBadges flags={{
                        reservaPrioritaria: l.reservaPrioritaria,
                        priorityDeadline:   l.priorityDeadline,
                        depositIntentAt:    l.depositIntentAt,
                      }} />
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] flex-wrap">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold border ${meta.sourceCls}`}>
                      {meta.sourceIcon} {meta.sourceLabel}
                    </span>
                    {l.germanLevel && <span className="text-slate-500 dark:text-slate-400 font-mono">{l.germanLevel}</span>}
                  </div>
                  <div className="mt-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                    🗓 {fmtTrialDate(l.trialAt)}
                    {l.attended && <span className="ml-2 text-emerald-600 dark:text-emerald-400">✓ asistió</span>}
                    {l.absent && !l.attended && <span className="ml-2 text-red-600 dark:text-red-400">✗ no asistió</span>}
                    {!l.attended && !l.absent && <span className="ml-2 text-slate-400">pendiente</span>}
                  </div>
                  {waDigits && (
                    <a
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold"
                    >
                      💬 Escribir por WhatsApp
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
