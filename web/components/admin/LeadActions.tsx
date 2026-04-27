"use client";

import { useState } from "react";
import Link from "next/link";
import { ConvertLeadModal } from "./ConvertLeadModal";
import { DeleteLeadButton } from "./DeleteLeadButton";

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
};

/**
 * All actionable buttons on a lead's detail page. Rendered as a client
 * component because the Convert flow opens a modal and handles its own
 * state.
 */
export function LeadActions({ lead }: { lead: Lead }) {
  const [convertOpen, setConvertOpen] = useState(false);

  const alreadyConverted = Boolean(lead.converted_to_user_id);
  const canConvert       = !alreadyConverted && lead.status !== "lost";
  const canReactivate    = lead.status === "needs_human";
  const canMarkLost      = lead.status !== "lost" && !alreadyConverted;
  const canMarkAttendance = lead.status === "trial_scheduled" || lead.status === "trial_reminded";

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
    </div>
  );
}
