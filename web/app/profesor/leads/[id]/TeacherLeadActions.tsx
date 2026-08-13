"use client";

/**
 * Panel "Acciones" del profe en /profesor/leads/[id] (Gelfis
 * 2026-08-13) — las mismas acciones que tiene el closer en su ficha,
 * usando los endpoints del Trial Hub del profe:
 *
 *  📅 Enviar enlace Clase de prueba → send-reschedule-link
 *  💳 Enviar enlace de inscripción  → PaymentLinkModal (send-offer)
 *  ✅ Confirmar pago                → ConfirmPaymentModal (conversión)
 *  🌐 Página web
 *
 * (El botón "Seguimiento" del closer no aplica: programa tareas en la
 * cola del closer, que el profe no tiene.)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentLinkModal } from "@/app/profesor/clasedeprueba/PaymentLinkModal";
import { ConfirmPaymentModal } from "@/components/teacher/ConfirmPaymentModal";

type Props = {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  leadPhone: string | null;
  leadLanguage: "es" | "de";
  leadGermanLevel: string | null;
  leadGoal: string | null;
};

export function TeacherLeadActions({
  leadId, leadName, leadEmail, leadPhone, leadLanguage, leadGermanLevel, leadGoal,
}: Props) {
  const router = useRouter();
  const [enlaceOpen, setEnlaceOpen] = useState(false);
  const [confirmPagoOpen, setConfirmPagoOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReagendar = async () => {
    if (!confirm(
      "REAGENDAR clase de prueba.\n\n" +
      "Esto va a:\n" +
      "  • Cancelar la clase futura del lead (si existe).\n" +
      "  • Enviar por WhatsApp el link para elegir nuevo horario.\n" +
      "  • Cambiar el estado del lead a 'Reagendando'.\n\n" +
      "¿Continuar?"
    )) return;
    setRescheduling(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/trial/${leadId}/send-reschedule-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? `HTTP ${res.status}`);
      alert("💬 Mensaje de reagendar enviado.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar reagendamiento");
    } finally {
      setRescheduling(false);
    }
  };

  const BUTTONS = [
    {
      key: "reagendar",
      icon: "📅",
      label: "Enviar enlace Clase de prueba",
      description: "Link para elegir nuevo horario de trial",
      onClick: handleReagendar,
    },
    {
      key: "enlace",
      icon: "💳",
      label: "Enviar enlace de inscripcion",
      description: "Enlace de pago (Stripe)",
      onClick: () => setEnlaceOpen(true),
    },
    {
      key: "confirmar_pago",
      icon: "✅",
      label: "Confirmar pago",
      description: "Crear estudiante y accesos",
      onClick: () => setConfirmPagoOpen(true),
    },
    {
      key: "pagina_web",
      icon: "🌐",
      label: "Página web",
      description: "Inscripciones en la web",
      onClick: () => window.open(
        `https://www.aprender-aleman.de/inscripciones?ref=${leadId}`,
        "_blank", "noopener,noreferrer",
      ),
    },
  ];

  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Acciones
      </h2>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        {BUTTONS.map((btn) => (
          <button
            key={btn.key}
            onClick={btn.onClick}
            disabled={rescheduling}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <span className="text-lg flex-shrink-0">{btn.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                {btn.label}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {btn.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Modales compartidos con el Trial Hub */}
      {enlaceOpen && (
        <PaymentLinkModal
          leadId={leadId}
          leadName={leadName}
          onClose={() => { setEnlaceOpen(false); router.refresh(); }}
        />
      )}

      {confirmPagoOpen && (
        <ConfirmPaymentModal
          leadId={leadId}
          leadName={leadName}
          leadEmail={leadEmail}
          leadPhone={leadPhone}
          leadLanguage={leadLanguage}
          leadGermanLevel={leadGermanLevel}
          leadGoal={leadGoal}
          onClose={() => { setConfirmPagoOpen(false); router.refresh(); }}
        />
      )}
    </section>
  );
}
