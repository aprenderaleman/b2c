"use client";

import Link from "next/link";
import { useState } from "react";
import type { SetterQueueItem } from "@/lib/setter-queue";

/**
 * Las dos listas del setter como pestañas (Gelfis 2026-10-24): un botón
 * para "Trials pendientes" y otro para "No asistieron" — se ve una lista
 * a la vez, no apiladas.
 */

const TABS = [
  {
    key: "pendiente" as const,
    label: "📞 Trials pendientes",
    hint: "Aún no llega su clase. Llama lo antes posible: confirma y pregunta qué quiere lograr. La cita más próxima, primero.",
    empty: "Todas las citas próximas están confirmadas ✅",
  },
  {
    key: "no_show" as const,
    label: "🔄 No asistieron",
    hint: "Llama y envíale el enlace de reagenda. El no-show más reciente, primero.",
    empty: "No hay no-shows pendientes de recuperar.",
  },
];

function fmtBerlinShort(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " (Berlín)";
}

export function SetterQueueTabs({
  pendientes,
  noShows,
  snoozed,
}: {
  pendientes: SetterQueueItem[];
  noShows: SetterQueueItem[];
  snoozed: { pendientes: number; noShows: number };
}) {
  const [active, setActive] = useState<"pendiente" | "no_show">("pendiente");

  const itemsByTab = { pendiente: pendientes, no_show: noShows };
  const snoozedByTab = { pendiente: snoozed.pendientes, no_show: snoozed.noShows };
  const tab = TABS.find(t => t.key === active)!;
  const items = itemsByTab[active];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border transition-colors ${
                isActive
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}>
                {itemsByTab[t.key].length}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">{tab.hint}</p>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{tab.empty}</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((it) => (
            <Link
              key={`${it.classId}-${it.tramo}`}
              href={`/setter/leads/${it.leadId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <span className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem]">
                {it.lead.name ?? "(sin nombre)"}
              </span>
              <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {fmtBerlinShort(it.citaAt)}
                {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
              </span>
              {it.sinMarcar && (
                <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                  sin marcar
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {it.lastSetterContact
                  ? `Último toque: ${fmtBerlinShort(it.lastSetterContact.occurred_at)}`
                  : "Sin contactar"}
              </span>
            </Link>
          ))}
        </div>
      )}

      {snoozedByTab[active] > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          ⏸️ {snoozedByTab[active]} en espera tras &quot;no contestó&quot; — vuelven solos a la lista (24h, o 2h antes de su clase).
        </p>
      )}
    </section>
  );
}
