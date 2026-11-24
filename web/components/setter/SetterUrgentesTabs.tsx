"use client";

import Link from "next/link";
import { useState } from "react";
import type { UrgenteItem } from "@/lib/setter-urgentes";

/**
 * Pestañas Hoy / Mañana de "Leads Urgentes" (Gelfis 2026-11-22). Muestra
 * TODAS las citas del día —confirmadas o no— con el último contacto en
 * grande: si fue hace días, toca darle un toque más antes de la clase.
 */

const ACTION_LABELS: Record<string, string> = {
  confirmar_cita: "confirmó",
  no_contesto:    "no contestó",
  reagendar:      "reagendó",
  llamada:        "llamada",
  whatsapp:       "WhatsApp",
};

function fmtHoraBerlin(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
  });
}

function fmtFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", day: "numeric", month: "short",
  });
}

/** Pill del último contacto: verde fresco, ámbar 3-5 días, rojo 6+ / nunca. */
function contactoPill(it: UrgenteItem): { text: string; cls: string } {
  if (!it.lastContact) {
    return {
      text: "Sin contactar nunca",
      cls: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
    };
  }
  const d = it.daysSinceContact ?? 0;
  const accion = ACTION_LABELS[it.lastContact.action_type] ?? it.lastContact.action_type.replace(/_/g, " ");
  const cuando = d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
  const text = `Último toque: ${cuando} (${fmtFechaCorta(it.lastContact.occurred_at)}) · ${accion}`;
  const cls =
    d >= 6 ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300" :
    d >= 3 ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" :
             "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  return { text, cls };
}

/** "agendó hace 25 min / 3 h / 2 días" para la pestaña de calientes. */
function hace(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

export function SetterUrgentesTabs({ hoy, manana, calientes }: {
  hoy: UrgenteItem[]; manana: UrgenteItem[]; calientes: UrgenteItem[];
}) {
  const [active, setActive] = useState<"calientes" | "hoy" | "manana">("calientes");
  const items = active === "hoy" ? hoy : active === "manana" ? manana : calientes;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {([
          { key: "calientes" as const, label: "🔥 Leads calientes", count: calientes.length },
          { key: "hoy" as const,       label: "📅 Leads de hoy",    count: hoy.length },
          { key: "manana" as const,    label: "🌅 Leads de mañana", count: manana.length },
        ]).map((t) => {
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
                isActive ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {active === "calientes"
          ? "Acaban de agendar y nadie los ha contactado todavía. Llámalos lo antes posible — el más reciente primero."
          : "Todas las citas del día, hayan confirmado o no. Si el último toque fue hace días (ámbar/rojo), dale un toque más antes de la clase."}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          {active === "calientes"
            ? "Todos los recién agendados ya fueron contactados 🔥✅"
            : active === "hoy" ? "No hay citas de leads hoy." : "No hay citas de leads mañana."}
        </p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((it) => {
            const pill = contactoPill(it);
            return (
              <Link
                key={it.classId}
                href={`/setter/leads/${it.leadId}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {active === "calientes"
                    ? `${fmtFechaCorta(it.citaAt)} · ${fmtHoraBerlin(it.citaAt)}`
                    : fmtHoraBerlin(it.citaAt)}
                </span>
                <span className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem]">
                  {it.lead.name ?? "(sin nombre)"}
                </span>
                <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
                  {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
                </span>
                {it.confirmada ? (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium">
                    ✅ confirmó
                  </span>
                ) : (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                    sin confirmar
                  </span>
                )}
                {active === "calientes" ? (
                  <span className="ml-auto text-xs rounded-full px-2.5 py-1 font-semibold bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300">
                    🔥 Agendó {hace(it.bookedAt)} · sin contactar
                  </span>
                ) : (
                  <span className={`ml-auto text-xs rounded-full px-2.5 py-1 font-medium ${pill.cls}`}>
                    {pill.text}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
