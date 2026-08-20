"use client";

/**
 * Card de Sesión de Plan-Alemán en /closer/sesiones.
 *
 * Solo lectura + accesos rápidos (WhatsApp, Aula, Ficha). Las acciones
 * del closer (Registrar, Asistió/No asistió, enlace de inscripción,
 * confirmar pago, etc.) viven en la ficha del lead /closer/leads/[id]
 * — decisión Gelfis 2026-08-13: sin botón "Acciones" duplicado aquí.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";

export type SesionRow = {
  classId: string;
  scheduledAt: string;
  durationMin: number;
  status: string;
  shortCode: string | null;
  leadId: string;
  leadName: string | null;
  leadWhatsapp: string | null;
  leadEmail: string | null;
  leadStatus: string;
  leadLanguage: "es" | "de";
  leadGermanLevel: string | null;
  leadGoal: string | null;
  qualification: { goal?: string; level?: string; deadline?: string } | null;
  reservaPrioritaria: boolean | null;
  priorityDeadline: string | null;
  depositIntentAt: string | null;
  trialAttendedAt: string | null;
  trialAbsentAt: string | null;
};

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Agendada",  cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  live:      { label: "En vivo",   cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30" },
  completed: { label: "Realizada", cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
  cancelled: { label: "Cancelada", cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" },
};

export function SesionHubCard({ row, closerName, fichaHref }: {
  row: SesionRow;
  closerName?: string;
  fichaHref?: string;
}) {
  const router = useRouter();
  const [rescheduling, setRescheduling] = useState(false);

  const handleReagendar = async () => {
    if (!confirm(
      "REAGENDAR sesión de plan.\n\n" +
      "Esto va a:\n" +
      "  • Cancelar la sesión actual del lead (si existe).\n" +
      "  • Enviar por WhatsApp el link a /sesion-plan/funnel.\n\n" +
      "Cuando el lead elija nuevo horario, se agendará automáticamente.\n\n" +
      "¿Continuar?"
    )) return;
    setRescheduling(true);
    try {
      const res = await fetch(`/api/closer/leads/${row.leadId}/send-sesion-reschedule-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? `HTTP ${res.status}`);
      alert("Mensaje de reagendar sesión enviado.");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al enviar reagendamiento");
    } finally {
      setRescheduling(false);
    }
  };

  const date = new Date(row.scheduledAt).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
  });
  const time = new Date(row.scheduledAt).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
  });

  const waDigits = row.leadWhatsapp ? row.leadWhatsapp.replace(/[^\d]/g, "") : null;
  const isConverted = row.leadStatus === "converted";
  const pill = STATUS_PILL[row.status] ?? { label: row.status, cls: "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
  const attended = !!row.trialAttendedAt;
  const absent = !!row.trialAbsentAt && !attended;

  return (
    <article className={`rounded-2xl border shadow-sm overflow-hidden ${attended ? "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-500/5" : absent ? "border-red-300 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/5" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"}`}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 capitalize">{date}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
              <span className="text-sm font-mono text-slate-700 dark:text-slate-200">{time}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">· {row.durationMin} min</span>
              <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${pill.cls}`}>
                {pill.label}
              </span>
              {isConverted && (
                <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                  Convertido
                </span>
              )}
              {row.trialAttendedAt && !isConverted && (
                <span className="text-[11px] rounded-full border px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                  ✓ asistió marcado
                </span>
              )}
              {row.trialAbsentAt && !row.trialAttendedAt && (
                <span className="text-[11px] rounded-full border px-2 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30">
                  ✗ no asistió marcado
                </span>
              )}
            </div>

            <div className="mt-2">
              <div className="text-base font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 flex-wrap">
                {row.leadName || "(sin nombre)"}
                <PriorityBadges flags={{
                  reservaPrioritaria: row.reservaPrioritaria,
                  priorityDeadline:   row.priorityDeadline,
                  depositIntentAt:    row.depositIntentAt,
                }} />
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                {row.leadGermanLevel && <span>Nivel <strong className="text-slate-700 dark:text-slate-200">{row.leadGermanLevel}</strong></span>}
                {row.leadEmail && <><span>·</span><span className="font-mono">{row.leadEmail}</span></>}
              {closerName && <><span>·</span><span>🎧 {closerName}</span></>}
              </div>
              {(() => {
                const q = summarizeQualification(row.qualification);
                if (!q) return null;
                return (
                  <div className="mt-1 text-[11.5px] text-slate-600 dark:text-slate-400 leading-snug">📋 {q}</div>
                );
              })()}
            </div>
          </div>

          {/* Accesos rápidos — las acciones viven en la Ficha */}
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch sm:min-w-[150px]">
            {waDigits ? (
              <a
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors"
              >
                💬 WhatsApp
              </a>
            ) : (
              <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 px-3.5 py-2 text-xs font-semibold cursor-not-allowed">
                💬 Sin WA
              </span>
            )}

            <a
              href={`/aula/${row.classId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-2 text-xs font-semibold transition-colors"
            >
              🎥 Videollamada
            </a>

            <Link
              href={fichaHref ?? `/closer/leads/${row.leadId}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 hover:bg-brand-100 dark:hover:bg-brand-500/20 text-brand-700 dark:text-brand-300 px-3.5 py-2 text-xs font-semibold transition-colors"
            >
              👤 Ficha
            </Link>

            {row.status === "scheduled" && (
              <button
                onClick={handleReagendar}
                disabled={rescheduling}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {rescheduling ? "Enviando..." : "📅 Reagendar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
