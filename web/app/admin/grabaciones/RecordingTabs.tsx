"use client";

import { useState } from "react";
import { RecordingRow, type RecordingRowItem } from "./RecordingRow";

type Tab = "contenido" | "regulares" | "prueba" | "sesiones";

type Props = {
  contentItems: RecordingRowItem[];
  regularItems: RecordingRowItem[];
  trialItems: RecordingRowItem[];
  sesionItems: RecordingRowItem[];
  isSuper: boolean;
};

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: "contenido", label: "Videos de contenido", icon: "🎬" },
  { key: "regulares", label: "Clases regulares",    icon: "📹" },
  { key: "prueba",    label: "Clases de prueba",     icon: "🎯" },
  { key: "sesiones",  label: "Sesiones de plan",     icon: "🤝" },
];

export function RecordingTabs({ contentItems, regularItems, trialItems, sesionItems, isSuper }: Props) {
  const [active, setActive] = useState<Tab>("contenido");

  const counts: Record<Tab, number> = {
    contenido: contentItems.length,
    regulares: regularItems.length,
    prueba:    trialItems.length,
    sesiones:  sesionItems.length,
  };

  const visibleTabs = isSuper ? tabs : tabs.filter(t => t.key !== "prueba" && t.key !== "sesiones");

  const items =
    active === "contenido" ? contentItems :
    active === "regulares" ? regularItems :
    active === "sesiones"  ? sesionItems  :
                             trialItems;

  const sectionStyles: Record<Tab, { border: string; bg: string; divider: string; headerBorder: string }> = {
    contenido: {
      border: "border-purple-200 dark:border-purple-500/30",
      bg: "bg-purple-50/40 dark:bg-purple-500/5",
      divider: "divide-purple-200/60 dark:divide-purple-500/20",
      headerBorder: "border-purple-200 dark:border-purple-500/30",
    },
    prueba: {
      border: "border-amber-300 dark:border-amber-500/40",
      bg: "bg-amber-50/40 dark:bg-amber-500/5",
      divider: "divide-amber-200/60 dark:divide-amber-500/20",
      headerBorder: "border-amber-200 dark:border-amber-500/30",
    },
    regulares: {
      border: "border-slate-200 dark:border-slate-800",
      bg: "bg-white dark:bg-slate-900",
      divider: "divide-slate-100 dark:divide-slate-800",
      headerBorder: "border-slate-100 dark:border-slate-800",
    },
    sesiones: {
      border: "border-sky-300 dark:border-sky-500/40",
      bg: "bg-sky-50/40 dark:bg-sky-500/5",
      divider: "divide-sky-200/60 dark:divide-sky-500/20",
      headerBorder: "border-sky-200 dark:border-sky-500/30",
    },
  };

  const style = sectionStyles[active];

  const emptyMessages: Record<Tab, string> = {
    contenido: "Aún no hay videos de contenido. Los profesores pueden crear sesiones desde /profesor/videos.",
    regulares: "Aún no hay grabaciones de clases regulares.",
    prueba:    "No hay grabaciones de clases de prueba.",
    sesiones:  "No hay grabaciones de sesiones de plan.",
  };

  return (
    <div className="space-y-4">
      {/* Tab buttons */}
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map(tab => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`
                inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all
                ${isActive
                  ? tab.key === "contenido"
                    ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
                    : tab.key === "prueba"
                      ? "bg-amber-500 text-white shadow-md shadow-amber-500/20"
                      : tab.key === "sesiones"
                        ? "bg-sky-600 text-white shadow-md shadow-sky-500/20"
                        : "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-md"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500"
                }
              `}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className={`
                rounded-full px-2 py-0.5 text-[11px] font-bold
                ${isActive
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }
              `}>
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active section */}
      <section className={`rounded-3xl border ${style.border} ${style.bg} overflow-hidden`}>
        {items.length === 0 ? (
          <p className="p-8 text-sm text-slate-500 dark:text-slate-400 text-center">
            {emptyMessages[active]}
          </p>
        ) : (
          <ul className={`divide-y ${style.divider}`}>
            {items.map(it => (
              <RecordingRow key={it.recording_id} item={it} canDownload={isSuper} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
