"use client";

/**
 * Mensajes de seguimiento del profe (Gelfis 2026-08-13) — copiables y
 * con envío directo por WhatsApp. Se muestra SOLO el set que aplica al
 * estado del lead (asistió / no asistió / clase pendiente).
 *
 * Textos aprobados por Gelfis en primera persona del profe (personales,
 * distintos de los de Stiv). Cambios de copy: editar aquí.
 */

import { useState } from "react";

type Estado = "asistio" | "no_asistio" | "pendiente";

type Props = {
  leadFirstName: string;
  whatsapp: string | null;
  estado: Estado;
  /** Etiqueta de la meta del lead, ej. "conseguir un mejor trabajo" */
  metaLabel: string;
  /** Hora Berlín de la clase (para el set pendiente), ej. "16:00" */
  trialTime: string;
};

function buildMessages(v: { nombre: string; meta: string; hora: string }, estado: Estado) {
  if (estado === "asistio") {
    return [
      {
        id: "a1",
        label: "Mismo día — gracias + puerta abierta",
        text: `¡Hola ${v.nombre}! Soy tu profe de la clase de hoy 😊 Me encantó conocerte — tienes una base mejor de lo que crees. Si te quedó cualquier duda sobre cómo seguiríamos con ${v.meta}, escríbeme por aquí y te la resuelvo.`,
      },
      {
        id: "a2",
        label: "A los 2-3 días — empujón a decidir",
        text: `¡Hola ${v.nombre}! ¿Cómo vas? Estuve pensando en tu caso y de verdad creo que con clases constantes llegas a ${v.meta} antes de lo que imaginas. Si quieres, te ayudo a elegir el plan que mejor te encaja — sin compromiso 😊`,
      },
      {
        id: "a3",
        label: "Cierre suave — última de mi parte",
        text: `${v.nombre}, no quiero insistirte — solo decirte que fue un gusto darte la clase y que cuando decidas retomar tu alemán, pregunta por mí y seguimos donde lo dejamos 🍀`,
      },
    ];
  }
  if (estado === "no_asistio") {
    return [
      {
        id: "b1",
        label: "Mismo día — sin reproche, reagendar",
        text: `¡Hola ${v.nombre}! Soy el/la profe que te esperaba hoy en tu clase de alemán 😊 Sé que a veces se complica el día — ¿te reagendo para otro momento? Dime qué día te viene mejor y te guardo el hueco.`,
      },
      {
        id: "b2",
        label: "Al día siguiente — valor + facilidad",
        text: `${v.nombre}, tu clase de prueba sigue disponible y me gustaría dártela yo — en 40 minutos sales sabiendo tu nivel real y el camino exacto hacia ${v.meta}. ¿Mañana o pasado te viene bien?`,
      },
      {
        id: "b3",
        label: "Cierre suave",
        text: `Última de mi parte, ${v.nombre} 😊 Tu clase gratuita queda guardada. Cuando tengas un hueco, me escribes y la hacemos — sin vueltas. ¡Que vaya bien! 🍀`,
      },
    ];
  }
  // pendiente
  return [
    {
      id: "c1",
      label: "Confirmación personal — la víspera",
      text: `¡Hola ${v.nombre}! Soy tu profe de mañana 😊 Te espero a las ${v.hora} (hora de Berlín) para tu clase de prueba. Ven con cámara y un lugar tranquilo — el resto lo pongo yo. ¡Nos vemos!`,
    },
    {
      id: "c2",
      label: "El día de la clase",
      text: `¡${v.nombre}! Hoy es el día 😊 Nos vemos a las ${v.hora} (Berlín) en tu clase de alemán. Si te surge cualquier cosa, escríbeme por aquí.`,
    },
  ];
}

const TITLE: Record<Estado, string> = {
  asistio:    "Mensajes de seguimiento (asistió)",
  no_asistio: "Mensajes de rescate (no asistió)",
  pendiente:  "Mensajes de confirmación (clase pendiente)",
};

export function FollowupMessages({ leadFirstName, whatsapp, estado, metaLabel, trialTime }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const waDigits = whatsapp?.replace(/\D/g, "") ?? "";

  const messages = buildMessages(
    { nombre: leadFirstName || "¡Hola!", meta: metaLabel, hora: trialTime },
    estado,
  );

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      // Fallback silencioso: el textarea ya muestra el texto para copiar a mano
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {TITLE[estado]}
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Copia el que toque según el momento — o envíalo directo por WhatsApp.
      </p>

      <div className="mt-3 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {m.label}
            </p>
            <p className="mt-1.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {m.text}
            </p>
            <div className="mt-2.5 flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => copy(m.id, m.text)}
                className={`text-xs font-semibold rounded-full border px-3 py-1.5 transition-colors ${
                  copied === m.id
                    ? "border-emerald-300 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
                    : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                {copied === m.id ? "✓ Copiado" : "📋 Copiar"}
              </button>
              {waDigits && (
                <a
                  href={`https://wa.me/${waDigits}?text=${encodeURIComponent(m.text)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 transition-colors"
                >
                  💬 Enviar por WhatsApp
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
