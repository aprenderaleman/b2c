"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  status: string;
  estado_cierre: string;
  fecha_asignacion_closer: string | null;
};

const ESTADO_LABELS: Record<string, { label: string; cls: string }> = {
  sin_asignar: {
    label: "Sin asignar",
    cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30",
  },
  en_seguimiento: {
    label: "En seguimiento",
    cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  },
  venta_pendiente: {
    label: "Venta pendiente",
    cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
  },
  convertido: {
    label: "Convertido",
    cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
  },
  perdido: {
    label: "Perdido",
    cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
  },
};

export function CloserLeadsList({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("todos");

  const filtered = filter === "todos"
    ? leads
    : leads.filter((l) => l.estado_cierre === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {["todos", "en_seguimiento", "venta_pendiente", "convertido", "perdido"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-medium rounded-full border px-3 py-1 transition-colors ${
              filter === f
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {f === "todos" ? "Todos" : ESTADO_LABELS[f]?.label ?? f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          No hay leads con este filtro.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((lead) => {
            const est = ESTADO_LABELS[lead.estado_cierre] ?? ESTADO_LABELS.sin_asignar;
            return (
              <button
                key={lead.id}
                onClick={() => router.push(`/closer/leads/${lead.id}`)}
                className="w-full text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                    {lead.name ?? lead.email ?? "Sin nombre"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lead.whatsapp_normalized ?? lead.email ?? ""}
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${est.cls}`}>
                  {est.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
