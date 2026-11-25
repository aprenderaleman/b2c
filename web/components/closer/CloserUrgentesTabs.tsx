"use client";

/**
 * Pestañas de /closer/urgentes (CRM Closer F2, Gelfis 2026-11-25).
 * Patrón visual de SetterUrgentesTabs: botones role="tab" con contador,
 * filas que enlazan a la ficha del lead.
 */

import { useState } from "react";
import Link from "next/link";
import type { CloserUrgenteItem, CloserUrgentes } from "@/lib/closer-urgentes";

type TabKey = "post_trial" | "no_show" | "antiguo";

const TAB_META: Record<TabKey, { label: string; empty: string }> = {
  post_trial: { label: "1️⃣ Post-trial sin cierre", empty: "Nadie pendiente de cierre. 🎉" },
  no_show:    { label: "2️⃣ No asistieron",         empty: "Sin no-shows pendientes." },
  antiguo:    { label: "3️⃣ Antiguos",              empty: "Sin leads antiguos asignados." },
};

export function CloserUrgentesTabs({ data }: { data: CloserUrgentes }) {
  const [tab, setTab] = useState<TabKey>("post_trial");

  const items: Record<TabKey, CloserUrgenteItem[]> = {
    post_trial: data.postTrial,
    no_show: data.noShows,
    antiguo: data.antiguos,
  };

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {(Object.keys(TAB_META) as TabKey[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            {TAB_META[key].label}
            <span className={`ml-2 inline-block rounded-full px-2 text-xs ${
              tab === key ? "bg-white/20" : "bg-slate-100 dark:bg-slate-700"
            }`}>
              {items[key].length}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        {items[tab].length === 0 ? (
          <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {TAB_META[tab].empty}
          </p>
        ) : (
          <ul className="space-y-2">
            {items[tab].map((item) => (
              <Row key={item.leadId} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ item }: { item: CloserUrgenteItem }) {
  return (
    <li>
      <Link
        href={`/closer/leads/${item.leadId}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="font-medium text-slate-900 dark:text-slate-100">{item.nombre}</span>

        {item.tramo === "post_trial" && item.enEspera && (
          <Chip cls="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700">
            ⏳ En espera — llamar a las 24h
          </Chip>
        )}
        {item.tramo === "post_trial" && !item.enEspera && item.bonoRestanteMs !== null && (
          <Chip cls={item.bonoRestanteMs < 6 * 3_600_000
            ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30"
            : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30"}>
            🎁 Bono: quedan {fmtRestante(item.bonoRestanteMs)}
          </Chip>
        )}
        {item.tramo === "post_trial" && !item.enEspera && item.bonoRestanteMs === null && (
          <Chip cls="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700">
            Bono vencido
          </Chip>
        )}
        {item.tramo === "no_show" && item.trialAbsentAt && (
          <Chip cls="bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30">
            ✗ No asistió {fmtFecha(item.trialAbsentAt)}
          </Chip>
        )}
        {item.tramo === "antiguo" && item.fechaAsignacion && (
          <Chip cls="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700">
            Asignado {fmtFecha(item.fechaAsignacion)}
          </Chip>
        )}

        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          {fmtContacto(item)}
        </span>
      </Link>
    </li>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

function fmtRestante(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", day: "numeric", month: "short",
  });
}

function fmtContacto(item: CloserUrgenteItem): string {
  const c = item.ultimoContacto;
  if (!c) return "sin contactos";
  const diff = Date.now() - new Date(c.occurred_at).getTime();
  const min = Math.floor(diff / 60_000);
  const ago = min < 60 ? `hace ${Math.max(1, min)} min`
    : min < 2880 ? `hace ${Math.floor(min / 60)}h`
    : `hace ${Math.floor(min / 1440)}d`;
  const who = c.actor_type === "stiv" ? "Stiv" : (c.actor_name?.split(/\s+/)[0] ?? c.actor_type);
  return `Último contacto: ${ago} (${who})`;
}
