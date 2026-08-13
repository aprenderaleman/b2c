"use client";

/**
 * Card de Sesión de Plan en /closer/sesiones — gemela del TrialHubCard
 * del profe (/profesor/clasedeprueba) para closers.
 *
 * Mismas acciones y MISMAS cadenas de mensajes que el profe:
 *  ✓ Asistió           → /api/teacher/trial/{leadId}/attended-no-link (chain1)
 *  💬 Objeción         → /api/teacher/trial/{leadId}/attended-objection (chain3_obj_*)
 *  ✗ No asistió        → /api/teacher/trial/{leadId}/absent (chain4)
 *  💳 Enviar enlace    → PaymentLinkModal (send-offer, chain2)
 *  💰 Confirmar pago   → ConfirmPaymentModal (conversión)
 *  📅 Reagendar        → send-reschedule-link
 *  🌐 Página web
 * (los endpoints del profe aceptan closer sobre SUS leads — allowCloser)
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { PaymentLinkModal } from "@/app/profesor/clasedeprueba/PaymentLinkModal";
import { ConfirmPaymentModal } from "@/components/teacher/ConfirmPaymentModal";

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

const OBJECTION_CHIPS = [
  { chip: "precio",   label: "💰 Precio" },
  { chip: "pensarlo", label: "🤔 Pensarlo" },
  { chip: "pareja",   label: "👫 Pareja/familia" },
  { chip: "tiempo",   label: "⏰ Tiempo" },
] as const;

export function SesionHubCard({ row }: { row: SesionRow }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);

  const date = new Date(row.scheduledAt).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
  });
  const time = new Date(row.scheduledAt).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
  });

  const waDigits = row.leadWhatsapp ? row.leadWhatsapp.replace(/[^\d]/g, "") : null;
  const isConverted = row.leadStatus === "converted";
  const pill = STATUS_PILL[row.status] ?? { label: row.status, cls: "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" };

  const post = async (path: string, body: unknown, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? j.reason ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(null);
      setObjectionOpen(false);
    }
  };

  return (
    <>
      <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
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

            {/* Quick actions */}
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
                🎥 Aula
              </a>

              <Link
                href={`/closer/leads/${row.leadId}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-2 text-xs font-semibold transition-colors"
              >
                👤 Ficha
              </Link>

              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                  expanded
                    ? "border-sky-400 bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-200"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                }`}
              >
                {expanded ? "Cerrar" : "Acciones"}
              </button>
            </div>
          </div>
        </div>

        {/* Expanded */}
        {expanded && (
          <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <InfoItem label="Teléfono" value={row.leadWhatsapp} />
              <InfoItem label="Email" value={row.leadEmail} />
              <InfoItem label="Objetivo" value={row.leadGoal} />
            </div>

            {!isConverted && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <ActionBtn
                  label="✓ Asistió"
                  cls="border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
                  busy={busy === `/api/teacher/trial/${row.leadId}/attended-no-link`}
                  onClick={() => post(
                    `/api/teacher/trial/${row.leadId}/attended-no-link`, {},
                    "Marcar como ASISTIÓ a la sesión.\n\n• Mensaje motivacional + cadena de seguimiento automática.\n\n¿Continuar?",
                  )}
                />
                <ActionBtn
                  label="💳 Enviar enlace de inscripción"
                  cls="border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
                  onClick={() => setPaymentOpen(true)}
                />
                <ActionBtn
                  label="💰 Confirmar Pago"
                  cls="border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
                  onClick={() => setConfirmPaymentOpen(true)}
                />
                <a
                  href={`https://www.aprender-aleman.de/inscripciones?ref=${row.leadId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold rounded-full border border-blue-300 dark:border-blue-500/40 bg-blue-100 dark:bg-blue-500/15 px-3 py-1.5 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-500/25 inline-block text-center"
                >
                  🌐 Página Web
                </a>
                <ActionBtn
                  label="💬 Objeción"
                  cls={objectionOpen
                    ? "border-violet-400 bg-violet-200 dark:bg-violet-500/25 text-violet-900 dark:text-violet-100"
                    : "border-violet-300 dark:border-violet-500/40 bg-violet-100 dark:bg-violet-500/15 text-violet-800 dark:text-violet-200 hover:bg-violet-200 dark:hover:bg-violet-500/25"}
                  onClick={() => setObjectionOpen(!objectionOpen)}
                />
                <ActionBtn
                  label="✗ No asistió"
                  cls="border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25"
                  busy={busy === `/api/teacher/trial/${row.leadId}/absent`}
                  onClick={() => post(
                    `/api/teacher/trial/${row.leadId}/absent`, {},
                    "Marcar como NO ASISTIÓ.\n\n• Follow-ups automáticos por WhatsApp.\n• Si responde → se escala.\n\n¿Continuar?",
                  )}
                />
                <ActionBtn
                  label="📅 Reagendar"
                  cls="border-sky-300 dark:border-sky-500/40 bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-500/25"
                  busy={busy === `/api/teacher/trial/${row.leadId}/send-reschedule-link`}
                  onClick={() => post(
                    `/api/teacher/trial/${row.leadId}/send-reschedule-link`, {},
                    "REAGENDAR.\n\n• Envía por WhatsApp el link para elegir nuevo horario.\n• Cancela la clase/sesión futura si existe.\n\n¿Continuar?",
                  )}
                />
              </div>
            )}

            {/* Objection chips */}
            {objectionOpen && !isConverted && (
              <div className="rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50/50 dark:bg-violet-500/5 p-3">
                <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
                  ¿Cuál es la objeción del lead?
                </div>
                <div className="flex flex-wrap gap-2">
                  {OBJECTION_CHIPS.map(({ chip, label }) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={!!busy}
                      onClick={() => post(
                        `/api/teacher/trial/${row.leadId}/attended-objection`, { chip },
                        `Marcar como ASISTIÓ CON OBJECIÓN: ${label}\n\nSe iniciará la cadena de mensajes para esta objeción.\n\n¿Continuar?`,
                      )}
                      className="text-xs font-semibold rounded-full border border-violet-300 dark:border-violet-500/40 bg-white dark:bg-slate-800 px-3 py-1.5 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50"
                    >
                      {busy ? "Enviando..." : label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </article>

      {/* Modales compartidos con el Trial Hub del profe */}
      {paymentOpen && (
        <PaymentLinkModal
          leadId={row.leadId}
          leadName={row.leadName || "Lead"}
          onClose={() => { setPaymentOpen(false); router.refresh(); }}
        />
      )}

      {confirmPaymentOpen && (
        <ConfirmPaymentModal
          leadId={row.leadId}
          leadName={row.leadName || ""}
          leadEmail={row.leadEmail}
          leadPhone={row.leadWhatsapp}
          leadLanguage={row.leadLanguage}
          leadGermanLevel={row.leadGermanLevel}
          leadGoal={row.leadGoal}
          onClose={() => { setConfirmPaymentOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 dark:text-slate-100 font-mono break-all">{value || "—"}</div>
    </div>
  );
}

function ActionBtn({ label, cls, onClick, busy }: {
  label: string; cls: string; onClick: () => void; busy?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`text-xs font-semibold rounded-full border px-3 py-1.5 disabled:opacity-50 ${cls}`}
    >
      {busy ? "..." : label}
    </button>
  );
}
