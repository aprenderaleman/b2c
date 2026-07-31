"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatBerlinDate, formatBerlinTime, formatGoalEs, formatStatusEs,
  type TrialClassRow,
} from "@/lib/trial-classes";
import { CancelTrialClassButton } from "@/components/CancelTrialClassButton";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { DeleteTrialClassButton } from "@/components/DeleteTrialClassButton";
import { ConvertLeadModal } from "@/components/admin/ConvertLeadModal";
import Link from "next/link";
import { MarkSaleModal } from "@/components/closer/MarkSaleModal";
import { NotesField } from "./NotesField";
import { PaymentLinkModal } from "./PaymentLinkModal";
import { ScheduleClassModal } from "./ScheduleClassModal";
import { PresentationLinks } from "./PresentationLinks";

export function TrialHubCard({
  row,
  expanded,
  onToggle,
  studentId,
  isAdmin = false,
  canDelete = false,
}: {
  row: TrialClassRow;
  expanded: boolean;
  onToggle: () => void;
  studentId: string | null;
  isAdmin?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [markSaleOpen, setMarkSaleOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateMsg, setEscalateMsg] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [voiceNoteSent, setVoiceNoteSent] = useState<string | null>(row.voiceNoteSentAt);
  const [togglingVoice, setTogglingVoice] = useState(false);
  const [reschedulingSend, setReschedulingSend] = useState(false);
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [objectionSending, setObjectionSending] = useState<string | null>(null);

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
                {row.trialConfirmedAt && row.status !== "cancelled" && (
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                    title={`Lead confirmó asistencia el ${new Date(row.trialConfirmedAt).toLocaleString("es-ES")}`}
                  >
                    ✅ Confirmado
                  </span>
                )}
                {isConverted && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                    Convertido
                  </span>
                )}
                {row.status !== "cancelled" && (
                  <VoiceNotePill
                    sentAt={voiceNoteSent}
                    loading={togglingVoice}
                    readOnly={isAdmin}
                    onToggle={async () => {
                      if (!row.leadId || isAdmin) return;
                      setTogglingVoice(true);
                      try {
                        const res = await fetch(`/api/teacher/trial/${row.leadId}/voice-note`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: "{}",
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const json = await res.json();
                        setVoiceNoteSent(json.voice_note_sent_at);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error");
                      } finally {
                        setTogglingVoice(false);
                      }
                    }}
                  />
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
                  {row.leadGoal && <><span>·</span><span>{formatGoalEs(row.leadGoal)}</span></>}
                </div>
                {(() => {
                  const q = summarizeQualification(row.qualificationAnswers);
                  if (!q) return null;
                  return (
                    <div className="mt-1 text-[11.5px] text-slate-600 dark:text-slate-400 leading-snug">
                      📋 {q}
                    </div>
                  );
                })()}
              </div>

              {isAdmin && row.leadEmail && (
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  📧 <span className="font-mono">{row.leadEmail}</span>
                </div>
              )}
              {isAdmin && row.leadWhatsapp && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  💬 <span className="font-mono">{row.leadWhatsapp}</span>
                </div>
              )}

              {isAdmin && (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Profesor: <span className="text-slate-700 dark:text-slate-200 font-medium">{row.teacherName}</span>
                </div>
              )}
            </div>

            {/* Quick actions — always visible */}
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch sm:min-w-[160px]">
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

              {isAdmin && (
                row.leadEmail ? (
                  <a
                    href={`mailto:${row.leadEmail}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors"
                  >
                    📧 Email
                  </a>
                ) : (
                  <span className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 px-3.5 py-2 text-xs font-semibold cursor-not-allowed">
                    📧 Sin email
                  </span>
                )
              )}

              <a
                href={aulaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-2 text-xs font-semibold transition-colors"
              >
                🎥 Aula
              </a>

              {isAdmin && (
                <a
                  href={`/cp/${row.classId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 px-3.5 py-2 text-xs font-semibold transition-colors"
                >
                  ▶ Iniciar cp
                </a>
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

              {isAdmin && row.leadId && (
                <Link
                  href={`/admin/leads/${row.leadId}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-3.5 py-2 text-xs font-semibold transition-colors"
                >
                  👤 Lead
                </Link>
              )}

              <CancelTrialClassButton
                classId={row.classId}
                scheduledAtIso={row.scheduledAt}
              />

              {canDelete && (
                <DeleteTrialClassButton
                  classId={row.classId}
                  scheduledAtIso={row.scheduledAt}
                />
              )}
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
                    💳 Enviar enlace de inscripción
                  </button>

                  <a
                    href="https://www.aprender-aleman.de/inscripciones"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold rounded-full border border-blue-300 dark:border-blue-500/40 bg-blue-100 dark:bg-blue-500/15 px-3 py-1.5 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-500/25 inline-block text-center"
                  >
                    🌐 Pagina Web
                  </a>

                  <button
                    type="button"
                    onClick={() => setObjectionOpen(!objectionOpen)}
                    className={`text-xs font-semibold rounded-full border px-3 py-1.5 ${
                      objectionOpen
                        ? "border-violet-400 bg-violet-200 dark:bg-violet-500/25 text-violet-900 dark:text-violet-100"
                        : "border-violet-300 dark:border-violet-500/40 bg-violet-100 dark:bg-violet-500/15 text-violet-800 dark:text-violet-200 hover:bg-violet-200 dark:hover:bg-violet-500/25"
                    }`}
                  >
                    💬 Objeción
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
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          throw new Error(`${j.error ?? `HTTP ${res.status}`}${j.detail ? ` — ${j.detail}` : ""}`);
                        }
                        router.refresh();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error");
                      }
                    }}
                    className="text-xs font-semibold rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 px-3 py-1.5 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25"
                  >
                    ✗ No asistio
                  </button>

                  {/* Reagendar — envía por WA el link /agendar/cuando
                      al lead. NO cambia estado ni cancela; útil cuando
                      el lead avisa antes que no puede en el horario. */}
                  <button
                    type="button"
                    disabled={reschedulingSend || !row.leadWhatsapp}
                    title={row.leadWhatsapp ? "Enviar por WhatsApp el link para reagendar" : "Lead sin WhatsApp — no se puede enviar"}
                    onClick={async () => {
                      if (!row.leadId) return;
                      if (!confirm(
                        "REAGENDAR clase de prueba.\n\n" +
                        "Esto va a:\n" +
                        "  • Cancelar la clase actual del lead.\n" +
                        "  • Enviar por WhatsApp el link a /agendar/cuando.\n" +
                        "  • Cambiar el estado del lead a 'Reagendando'.\n\n" +
                        "Cuando el lead elija nuevo horario, vuelve a 'Clase agendada' automáticamente.\n\n" +
                        "¿Continuar?"
                      )) return;
                      setReschedulingSend(true);
                      try {
                        const res = await fetch(`/api/teacher/trial/${row.leadId}/send-reschedule-link`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: "{}",
                        });
                        const json = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(json.reason ?? `HTTP ${res.status}`);
                        alert("💬 Mensaje de reagendar enviado.");
                        router.refresh();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Error");
                      } finally {
                        setReschedulingSend(false);
                      }
                    }}
                    className="text-xs font-semibold rounded-full border border-sky-300 dark:border-sky-500/40 bg-sky-100 dark:bg-sky-500/15 px-3 py-1.5 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reschedulingSend ? "Enviando..." : "📅 Reagendar"}
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

              {!isConverted && row.leadId && (
                <button
                  type="button"
                  onClick={() => setMarkSaleOpen(true)}
                  className="text-xs font-semibold rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
                >
                  💰 Marcar como vendido
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

              {/* Escalar a Admin — solo profes, admin no se escala a sí mismo */}
              {!isAdmin && row.leadId && (
                <button
                  type="button"
                  onClick={() => setEscalateOpen(!escalateOpen)}
                  className="text-xs font-semibold rounded-full border border-rose-300 dark:border-rose-500/40 bg-rose-100 dark:bg-rose-500/15 px-3 py-1.5 text-rose-800 dark:text-rose-200 hover:bg-rose-200 dark:hover:bg-rose-500/25"
                >
                  🚨 Escalar a Admin
                </button>
              )}
            </div>

            {/* Objection chips */}
            {objectionOpen && row.leadId && !isProcessed && (
              <div className="mt-3 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50/50 dark:bg-violet-500/5 p-3">
                <div className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
                  ¿Cuál es la objeción del lead?
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { chip: "precio",   label: "💰 Precio",         desc: "El precio es muy alto" },
                    { chip: "pensarlo", label: "🤔 Pensarlo",       desc: "Necesita pensarlo" },
                    { chip: "pareja",   label: "👫 Pareja/familia", desc: "Debe consultarlo con alguien" },
                    { chip: "tiempo",   label: "⏰ Tiempo",         desc: "No tiene tiempo" },
                  ] as const).map(({ chip, label, desc }) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={!!objectionSending}
                      title={desc}
                      onClick={async () => {
                        if (!confirm(
                          `Marcar como ASISTIÓ CON OBJECIÓN: ${label}\n\n` +
                          "Se iniciará la cadena de mensajes para esta objeción.\n\n" +
                          "¿Continuar?"
                        )) return;
                        setObjectionSending(chip);
                        try {
                          const res = await fetch(`/api/teacher/trial/${row.leadId}/attended-objection`, {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ chip }),
                          });
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          setObjectionOpen(false);
                          router.refresh();
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "Error");
                        } finally {
                          setObjectionSending(null);
                        }
                      }}
                      className="text-xs font-semibold rounded-full border border-violet-300 dark:border-violet-500/40 bg-white dark:bg-slate-800 px-3 py-1.5 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {objectionSending === chip ? "Enviando..." : label}
                    </button>
                  ))}
                </div>
              </div>
            )}

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

      {markSaleOpen && row.leadId && (
        <MarkSaleModal
          leadId={row.leadId}
          onClose={() => setMarkSaleOpen(false)}
          endpoint={`/api/teacher/trial/${row.leadId}/mark-sale`}
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

function VoiceNotePill({
  sentAt,
  loading,
  readOnly,
  onToggle,
}: {
  sentAt: string | null;
  loading: boolean;
  readOnly: boolean;
  onToggle: () => void;
}) {
  const sent = !!sentAt;
  const title = sent
    ? `Nota de voz enviada el ${new Date(sentAt!).toLocaleString("es-ES")}`
    : "Nota de voz pendiente";

  if (readOnly) {
    return (
      <span
        className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${
          sent
            ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30"
            : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30"
        }`}
        title={title}
      >
        {sent ? "🎤 Nota enviada" : "🎤 Sin nota"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 transition-colors disabled:opacity-50 ${
        sent
          ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30 hover:bg-violet-100 dark:hover:bg-violet-500/20"
          : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
      }`}
      title={title}
    >
      {loading ? "..." : sent ? "🎤 Nota enviada" : "🎤 Enviar nota"}
    </button>
  );
}

function normalizeLevel(level: string | null | undefined): string | undefined {
  if (!level) return undefined;
  if (level.startsWith("A1")) return "A1";
  if (level.startsWith("A2")) return "A2";
  if (level.startsWith("B2")) return "B2";
  return level;
}
