"use client";

import { useState } from "react";
import Link from "next/link";
import { ConvertLeadModal } from "./ConvertLeadModal";
import { DeleteLeadButton } from "./DeleteLeadButton";
import { EditLeadModal }    from "./EditLeadModal";

type Lead = {
  id:    string;
  name:  string;
  email: string | null;
  phone: string;
  language:     "es" | "de";
  german_level: string;
  goal:         string | null;
  status:       string;
  converted_to_user_id: string | null;
  student_id:   string | null;   // resolved server-side if converted_to_user_id exists
  ai_paused_until: string | null; // ISO; Stiv holds replies while > now()
};

/**
 * All actionable buttons on a lead's detail page. Rendered as a client
 * component because the Convert flow opens a modal and handles its own
 * state.
 */
export function LeadActions({ lead }: { lead: Lead }) {
  const [convertOpen, setConvertOpen] = useState(false);
  const [editOpen,    setEditOpen]    = useState(false);

  const alreadyConverted = Boolean(lead.converted_to_user_id);
  const canConvert       = !alreadyConverted && lead.status !== "lost";
  const canReactivate    = lead.status === "needs_human";
  const canMarkLost      = lead.status !== "lost" && !alreadyConverted;
  const canMarkAttendance = lead.status === "trial_scheduled" || lead.status === "trial_reminded";

  // Stiv (AI) is paused for this lead while ai_paused_until is in
  // the future. The pause does NOT change the funnel status — it
  // just gates the agent's auto-replies.
  const aiPaused = Boolean(
    lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > Date.now(),
  );

  const canResendConfirmation =
    (lead.status === "trial_scheduled" || lead.status === "trial_reminded")
    && Boolean(lead.phone);

  const [resending,    setResending]   = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const onResend = async () => {
    if (!confirm("Reenviar la confirmación de la clase de prueba al WhatsApp del lead?")) return;
    setResending(true);
    setResendNotice(null);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/resend-confirmation`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResendNotice("✓ Reenviado");
      } else {
        setResendNotice("✗ " + (data.reason || data.error || "Error"));
      }
    } catch (e) {
      setResendNotice("✗ " + (e instanceof Error ? e.message : "error"));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {alreadyConverted && lead.student_id && (
        <Link
          href={`/admin/estudiantes/${lead.student_id}`}
          className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
        >
          Ver estudiante →
        </Link>
      )}

      {/* Resend trial confirmation — manual recovery for the case
          where Evolution dropped the message at booking time
          (http_503: no available server). Refuses if no upcoming
          trial or no phone on file (server-side check). */}
      {canResendConfirmation && (
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="text-xs font-semibold rounded-full border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 px-3 py-1 text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
          title="Reenviar la confirmación de la clase al WhatsApp del lead"
        >
          {resending ? "Reenviando…" : resendNotice ?? "💬 Reenviar confirmación"}
        </button>
      )}

      {/* Manual editor — fixes typos in name/email/whatsapp/level/goal
          without going through the funnel again. Most common reason
          today: the +34 prefix double-typed by leads who paste the
          country code into the phone field as well. */}
      {!alreadyConverted && (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-xs font-medium rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1 text-slate-700 dark:text-slate-200"
          title="Editar nombre, email, WhatsApp, nivel u objetivo"
        >
          ✎ Editar datos
        </button>
      )}

      {/* Stiv takeover toggle — pauses or reactivates the AI on this
          single lead, without touching status or follow-up counters. */}
      {!alreadyConverted && lead.status !== "lost" && (
        <form
          action={`/api/admin/leads/${lead.id}/ai-pause`}
          method="post"
        >
          <input type="hidden" name="paused" value={aiPaused ? "false" : "true"} />
          <button
            type="submit"
            className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors ${
              aiPaused
                ? "border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25"
                : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            }`}
            title={aiPaused
              ? "Stiv está pausado para este lead. Pulsa para reactivarlo."
              : "Pausa Stiv para este lead y toma la conversación tú."}
          >
            {aiPaused ? "▶ Reactivar Stiv" : "✋ Tomo yo desde aquí"}
          </button>
        </form>
      )}

      {canMarkAttendance && (
        <>
          <form
            action={`/api/admin/leads/${lead.id}/trial/attended`}
            method="post"
            onSubmit={(e) => {
              if (!confirm(
                "Marcar el lead como ASISTIÓ a la clase de prueba.\n\n" +
                "• Pasa a estado 'in_conversation'.\n" +
                "• Le mandamos un WhatsApp pidiendo feedback y ofreciendo un plan personalizado.\n\n" +
                "¿Continuar?"
              )) e.preventDefault();
            }}
          >
            <button
              type="submit"
              className="text-xs font-semibold rounded-full border border-emerald-300 dark:border-emerald-500/40 bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/25"
              title="Lead asistió a la clase de prueba"
            >
              ✓ Asistió
            </button>
          </form>
          <form
            action={`/api/admin/leads/${lead.id}/trial/absent`}
            method="post"
            onSubmit={(e) => {
              if (!confirm(
                "Marcar el lead como NO ASISTIÓ a la clase de prueba.\n\n" +
                "• Pasa a estado 'trial_absent'.\n" +
                "• En 24h, 4 días y 10 días el sistema le manda follow-ups automáticos. Si no responde, lo marca como 'lost'.\n\n" +
                "¿Continuar?"
              )) e.preventDefault();
            }}
          >
            <button
              type="submit"
              className="text-xs font-semibold rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 px-3 py-1 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25"
              title="Lead no se conectó a la clase de prueba"
            >
              ✗ No asistió
            </button>
          </form>
        </>
      )}

      {canConvert && (
        <button
          type="button"
          onClick={() => setConvertOpen(true)}
          className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
        >
          Convertir en estudiante
        </button>
      )}

      {canReactivate && (
        <form action={`/api/admin/leads/${lead.id}/reactivate`} method="post">
          <button type="submit" className="text-xs font-medium rounded-full border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-3 py-1 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20">
            Reactivar seguimiento auto
          </button>
        </form>
      )}

      {canMarkLost && (
        <form action={`/api/admin/leads/${lead.id}/lost`} method="post">
          <button type="submit" className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            Marcar perdido
          </button>
        </form>
      )}

      <a
        href={`/api/admin/leads/${lead.id}/export`}
        className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        title="RGPD: descargar todos los datos de este lead"
      >
        Exportar (JSON)
      </a>

      <DeleteLeadButton leadId={lead.id} />

      {/* Conversion modal */}
      <ConvertLeadModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        lead={{
          id: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          language: lead.language,
          german_level: lead.german_level,
          goal: lead.goal,
        }}
      />

      {/* Edit modal */}
      <EditLeadModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        lead={{
          id:                  lead.id,
          name:                lead.name,
          email:               lead.email,
          whatsapp_normalized: lead.phone || null,
          language:            lead.language,
          german_level:        lead.german_level,
          goal:                lead.goal,
        }}
      />
    </div>
  );
}
