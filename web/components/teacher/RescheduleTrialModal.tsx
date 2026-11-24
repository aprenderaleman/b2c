"use client";

/**
 * Ventana "Reagendar" del profe (Gelfis 2026-11-24).
 *
 * El profe elige el motivo:
 *   • "Lead no confirmó"      — solo si el lead no confirmó por ninguna vía,
 *     la nota de voz está marcada y falta ≤ 1 h para la clase. El servidor
 *     decide (GET del mismo endpoint) y aquí solo se muestra el porqué.
 *   • "No puedo dar la clase" — abre un cuadro para escribir el motivo, que
 *     ve el admin; al lead solo se le dice "por un imprevisto".
 * En ambos casos se cancela la clase, el lead pasa a "Reagendando" y recibe
 * su mensaje con el enlace para elegir nueva fecha.
 */

import { useEffect, useState } from "react";
import { NOTE_MAX_CHARS, NOTE_MIN_CHARS, type TeacherRescheduleReason } from "@/lib/trial-reschedule-reason";

type Status = {
  hasUpcomingTrial: boolean;
  scheduledAt: string | null;
  leadConfirmed: boolean;
  voiceNoteSent: boolean;
  noConfirm: { allowed: boolean; blockedBy: string | null; message: string | null };
};

type Props = {
  leadId: string;
  leadName: string;
  /** Antes de enviar (p. ej. guardar las notas del profe). */
  beforeSubmit?: () => Promise<void> | void;
  onClose: () => void;
  onDone: () => void;
};

export function RescheduleTrialModal({ leadId, leadName, beforeSubmit, onClose, onDone }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState<TeacherRescheduleReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/teacher/trial/${leadId}/send-reschedule-link`, { cache: "no-store" })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setLoadError(j.reason ?? j.error ?? `HTTP ${r.status}`); return; }
        setStatus(j as Status);
      })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : "Error"); });
    return () => { alive = false; };
  }, [leadId]);

  const firstName = leadName.trim().split(/\s+/)[0] || leadName;
  const noteClean = note.replace(/\s+/g, " ").trim();
  const noConfirmOk = !!status?.noConfirm.allowed;
  const canSend =
    !!status?.hasUpcomingTrial && !sending &&
    ((reason === "lead_no_confirmo" && noConfirmOk) ||
     (reason === "profe_no_puede" && noteClean.length >= NOTE_MIN_CHARS));

  const whenLabel = status?.scheduledAt
    ? new Date(status.scheduledAt).toLocaleString("es-ES", {
        timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      }) + " (Berlín)"
    : null;

  const submit = async () => {
    if (!canSend || !reason) return;
    setSending(true);
    setError(null);
    try {
      await beforeSubmit?.();
      const res = await fetch(`/api/teacher/trial/${leadId}/send-reschedule-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason === "profe_no_puede" ? { reason, note: noteClean } : { reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? json.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reagendar");
      setSending(false);
    }
  };

  const optionCls = (active: boolean, disabled: boolean) =>
    `w-full text-left rounded-2xl border p-4 transition-colors ${
      disabled
        ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 opacity-70 cursor-not-allowed"
        : active
          ? "border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-500/10"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reagendar clase de prueba"
      onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Reagendar la clase de {firstName}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {whenLabel ? `Clase del ${whenLabel}. ` : ""}
            Se cancela esta clase y {firstName} recibe un mensaje con el enlace para elegir nueva fecha.
          </p>
        </header>

        <div className="p-6 space-y-3">
          {loadError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">No se pudo cargar: {loadError}</p>}
          {!status && !loadError && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}

          {status && !status.hasUpcomingTrial && (
            <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
              Este lead no tiene una clase de prueba futura agendada, así que no hay nada que reagendar.
            </p>
          )}

          {status?.hasUpcomingTrial && (
            <>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">¿Por qué la reagendas?</p>

              <button
                type="button"
                disabled={!noConfirmOk || sending}
                aria-pressed={reason === "lead_no_confirmo"}
                onClick={() => setReason("lead_no_confirmo")}
                className={optionCls(reason === "lead_no_confirmo", !noConfirmOk)}
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">Lead no confirmó</span>
                <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                  {noConfirmOk
                    ? `${firstName} no confirmó por ninguna vía y ya le enviaste tu nota de voz.`
                    : status.noConfirm.message}
                </span>
              </button>

              <button
                type="button"
                disabled={sending}
                aria-pressed={reason === "profe_no_puede"}
                onClick={() => setReason("profe_no_puede")}
                className={optionCls(reason === "profe_no_puede", false)}
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">No puedo dar la clase</span>
                <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                  {firstName} recibirá una disculpa y el enlace. Tu motivo solo lo ve la academia.
                </span>
              </button>

              {reason === "profe_no_puede" && (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Motivo</span>
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value.slice(0, NOTE_MAX_CHARS))}
                    rows={3}
                    autoFocus
                    disabled={sending}
                    className="input-text mt-1 w-full"
                    placeholder="Ej.: se me cruza con otra clase a esa hora"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    {noteClean.length}/{NOTE_MAX_CHARS}
                  </span>
                </label>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={!canSend}>
            {sending ? "Enviando…" : "Reagendar y avisar al lead"}
          </button>
        </footer>
      </div>
    </div>
  );
}
