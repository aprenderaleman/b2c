"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatBerlinDate, formatBerlinTime, formatGoalEs, formatStatusEs,
  type TrialClassRow,
} from "@/lib/trial-classes";
import { DeleteTrialClassButton } from "@/components/DeleteTrialClassButton";
import { ConvertLeadModal } from "@/components/admin/ConvertLeadModal";
import { NotesField } from "./NotesField";
import { PaymentLinkModal } from "./PaymentLinkModal";
import { ScheduleClassModal } from "./ScheduleClassModal";
import { PresentationLinks } from "./PresentationLinks";

export function TrialHubCard({
  row,
  expanded,
  onToggle,
  studentId,
}: {
  row: TrialClassRow;
  expanded: boolean;
  onToggle: () => void;
  studentId: string | null;
}) {
  const router = useRouter();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateMsg, setEscalateMsg] = useState("");
  const [escalating, setEscalating] = useState(false);

  const date = formatBerlinDate(row.scheduledAt);
  const time = formatBerlinTime(row.scheduledAt);
  const waDigits = row.leadWhatsapp ? row.leadWhatsapp.replace(/[^\d]/g, "") : null;
  const aulaUrl = `/aula/${row.classId}`;
  const isConverted = row.leadStatus === "converted";
  const isProcessed = !!row.scriptFinalOutcome;

  const normalizedLevel = normalizeLevel(row.leadGermanLevel);

  return (
    <>
      <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* ── Header (always visible) ── */}
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 capitalize">
                  {date}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
                <span className="text-sm font-mono text-slate-700 dark:text-slate-200">{time}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{row.durationMinutes} min</span>
                <StatusPill status={row.status} />
                {isConverted && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                    Convertido
                  </span>
                )}
              </div>

              <div className="mt-2">
                <div className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {row.leadName || "(sin nombre)"}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                  {row.leadGermanLevel && <span>Nivel <strong className="text-slate-700 dark:text-slate-200">{row.leadGermanLevel}</strong></span>}
                  {row.leadGoal && <><span>·</span><span>{formatGoalEs(row.leadGoal)}</span></>}
                </div>
              </div>
            </div>

            {/* Quick actions — always visible */}
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch sm:min-w-[140px]">
              <a
                href={aulaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-2 text-xs font-semibold transition-colors"
              >
                🎥 Aula
              </a>

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

              <button
                type="button"
                onClick={onToggle}
                className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                  expanded
                    ? "border-sky-400 bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-200"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                }`}
              >
                👤 {expanded ? "Cerrar" : "Ver Lead"}
              </button>

              <DeleteTrialClassButton
                classId={row.classId}
                scheduledAtIso={row.scheduledAt}
              />
            </div>
          </div>
        </div>

        {/* ── Expanded panel ── */}
        {expanded && (
          <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4 sm:p-5 space-y-5">
            {/* Lead info */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <InfoItem label="Nombre" value={row.leadName} />
              <InfoItem label="Telefono" value={row.leadWhatsapp} />
              <InfoItem label="Email" value={row.leadEmail} />
            </div>

            {/* Agent diagnostic note */}
            {row.leadFirstNote && (
              <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
                  Nota del agente
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{row.leadFirstNote}</p>
              </div>
            )}

            {/* Notes */}
            <NotesField classId={row.classId} initialNotes={row.scriptTeacherNotes} />

            {/* Presentations */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                Presentaciones
              </label>
              <PresentationLinks defaultLevel={normalizedLevel} />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              {!isProcessed && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!row.leadId) return;
                      if (!confirm("Marcar como ASISTIO.\n\n¿Continuar?")) return;
                      try {
                        const res = await fetch(`/api/teacher/trial/${row.leadId}/attended-no-link`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: "{}",
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        router.refresh();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error");
                      }
                    }}
                    className="text-xs font-semibold rounded-full border border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1.5 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
                  >
                    ✓ Asistio
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentOpen(true)}
                    className="text-xs font-semibold rounded-full border border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1.5 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
                  >
                    💳 Enviar enlace de pago
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      if (!row.leadId) return;
                      if (!confirm(
                        "Marcar como NO ASISTIO.\n\n" +
                        "• 3 follow-ups automaticos por WhatsApp.\n" +
                        "• Si responde → se escala.\n\n" +
                        "¿Continuar?"
                      )) return;
                      try {
                        const res = await fetch(`/api/teacher/trial/${row.leadId}/absent`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: "{}",
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        router.refresh();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error");
                      }
                    }}
                    className="text-xs font-semibold rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 px-3 py-1.5 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25"
                  >
                    ✗ No asistio
                  </button>
                </>
              )}

              {!isConverted && row.leadId && (
                <button
                  type="button"
                  onClick={() => setConvertOpen(true)}
                  className="text-xs font-semibold rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
                >
                  🎓 Convertir a estudiante
                </button>
              )}

              {isConverted && studentId && (
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  className="text-xs font-semibold rounded-full border border-sky-300 dark:border-sky-500/40 bg-sky-100 dark:bg-sky-500/15 px-3 py-1.5 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-500/25"
                >
                  📅 Agendar clases
                </button>
              )}

              {isConverted && !studentId && (
                <span className="text-xs text-slate-400 py-1.5">
                  📅 Agendar clases (resolviendo estudiante...)
                </span>
              )}

              {/* Escalar a Admin */}
              {row.leadId && (
                <button
                  type="button"
                  onClick={() => setEscalateOpen(!escalateOpen)}
                  className="text-xs font-semibold rounded-full border border-rose-300 dark:border-rose-500/40 bg-rose-100 dark:bg-rose-500/15 px-3 py-1.5 text-rose-800 dark:text-rose-200 hover:bg-rose-200 dark:hover:bg-rose-500/25"
                >
                  🚨 Escalar a Admin
                </button>
              )}
            </div>

            {/* Escalation form */}
            {escalateOpen && row.leadId && (
              <div className="mt-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5 p-3 space-y-2">
                <textarea
                  value={escalateMsg}
                  onChange={(e) => setEscalateMsg(e.target.value)}
                  rows={2}
                  placeholder="Explica brevemente lo sucedido..."
                  className="w-full rounded-lg border border-rose-200 dark:border-rose-500/30 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => { setEscalateOpen(false); setEscalateMsg(""); }}
                    className="text-xs rounded-full border border-slate-300 dark:border-slate-600 px-3 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={escalateMsg.trim().length < 3 || escalating}
                    onClick={async () => {
                      setEscalating(true);
                      try {
                        const res = await fetch(`/api/teacher/trial/${row.leadId}/escalate`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ message: escalateMsg.trim() }),
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        setEscalateOpen(false);
                        setEscalateMsg("");
                        alert("Escalado enviado al admin.");
                        router.refresh();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error al escalar");
                      } finally {
                        setEscalating(false);
                      }
                    }}
                    className="text-xs font-semibold rounded-full border border-rose-400 bg-rose-500 text-white px-3 py-1 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {escalating ? "Enviando..." : "Enviar escalacion"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </article>

      {/* Modals */}
      {paymentOpen && row.leadId && (
        <PaymentLinkModal
          leadId={row.leadId}
          leadName={row.leadName || "Lead"}
          defaultLevel={normalizedLevel}
          onClose={() => setPaymentOpen(false)}
        />
      )}

      {convertOpen && row.leadId && (
        <ConvertLeadModal
          lead={{
            id:           row.leadId,
            name:         row.leadName || "",
            email:        row.leadEmail,
            phone:        row.leadWhatsapp || "",
            language:     row.leadLanguage || "es",
            german_level: row.leadGermanLevel || "A0",
            goal:         row.leadGoal,
          }}
          open={convertOpen}
          onClose={() => setConvertOpen(false)}
          convertEndpoint={`/api/teacher/trial/${row.leadId}/convert`}
        />
      )}

      {scheduleOpen && studentId && (
        <ScheduleClassModal
          studentId={studentId}
          studentName={row.leadName || "Estudiante"}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="text-sm text-slate-900 dark:text-slate-100 font-mono">
        {value || "—"}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, { label: string; cls: string }> = {
    scheduled: { label: formatStatusEs("scheduled"), cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
    live:      { label: formatStatusEs("live"),      cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30" },
    completed: { label: formatStatusEs("completed"), cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
    cancelled: { label: formatStatusEs("cancelled"), cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" },
  };
  const v = labels[status] ?? { label: status, cls: "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${v.cls}`}>
      {v.label}
    </span>
  );
}

function normalizeLevel(level: string | null | undefined): string | undefined {
  if (!level) return undefined;
  if (level.startsWith("A1")) return "A1";
  if (level.startsWith("A2")) return "A2";
  if (level.startsWith("B2")) return "B2";
  return level;
}
