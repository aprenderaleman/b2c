"use client";

/**
 * Mensajes de seguimiento del CLOSER (Gelfis 2026-08-13) — copiables y
 * con envío directo por WhatsApp, en la ficha /closer/leads/[id].
 *
 * Voz de asesor ("tu Sesión de Plan-Alemán", "tu plan"), distinta de la del
 * profe y de Stiv. Se muestra SOLO el set que aplica al estado del
 * lead: sesión pendiente / asistió / no asistió.
 * Cambios de copy: editar aquí.
 */

import { useState } from "react";

type Estado = "asistio" | "no_asistio" | "pendiente";

type Props = {
  leadFirstName: string;
  whatsapp: string | null;
  estado: Estado;
  /** Meta del lead en lenguaje natural, ej. "conseguir un mejor trabajo" */
  metaLabel: string;
  /** ISO de la Sesión de Plan-Alemán (para hora/día en el set pendiente) */
  sesionAt: string | null;
};

// Meta del lead (enum lead_goal) → lenguaje natural para los mensajes
export const CLOSER_META_LABEL: Record<string, string> = {
  work:            "conseguir un mejor trabajo",
  visa:            "tus trámites y tu visa",
  studies:         "tus estudios",
  exam:            "tu examen oficial",
  travel:          "tu meta con el alemán",
  already_in_dach: "desenvolverte en tu día a día",
};

function buildMessages(
  v: { nombre: string; meta: string; hora: string; dia: string },
  estado: Estado,
) {
  if (estado === "asistio") {
    return [
      {
        id: "a1",
        label: "Mismo día — gracias + dudas",
        text: `¡Hola ${v.nombre}! Gracias por la sesión de hoy 😊 Como vimos, para ${v.meta} tu mejor jugada es empezar ya. Cualquier duda sobre el plan o la inscripción, escríbeme por aquí y lo resolvemos en un minuto.`,
      },
      {
        id: "a2",
        label: "A los 2-3 días — empujón a decidir",
        text: `¡${v.nombre}! ¿Pudiste pensarlo? Tu plan queda tal como lo armamos: si empiezas esta semana, llegas a ${v.meta} en el plazo que hablamos. Cuando me digas, te ayudo con la inscripción 😊`,
      },
      {
        id: "a3",
        label: "Cierre suave — última de mi parte",
        text: `${v.nombre}, no te insisto más 😊 Tu plan queda guardado tal como lo armamos juntos. Cuando decidas arrancar, me escribes y lo activamos. ¡Éxitos! 🍀`,
      },
    ];
  }
  if (estado === "no_asistio") {
    return [
      {
        id: "b1",
        label: "Mismo día — sin reproche, reagendar",
        text: `¡Hola ${v.nombre}! Te esperé en tu Sesión de Plan-Alemán 😊 Sé que a veces el día se complica — ¿la movemos? Dime qué día y hora te van mejor y te reservo el hueco.`,
      },
      {
        id: "b2",
        label: "Al día siguiente — valor + facilidad",
        text: `${v.nombre}, tu Sesión de Plan-Alemán sigue disponible — son solo 25 minutos y sales sabiendo exactamente cómo llegar a ${v.meta}, con fechas y precio claros. ¿Hoy o mañana te viene bien?`,
      },
      {
        id: "b3",
        label: "Cierre suave",
        text: `Última de mi parte, ${v.nombre} 😊 Tu sesión queda guardada. Cuando tengas 25 minutos, me escribes y la hacemos — sin vueltas. ¡Que vaya bien! 🍀`,
      },
    ];
  }
  // pendiente
  return [
    {
      id: "c1",
      label: "Confirmación personal — antes de la sesión",
      text: `¡Hola ${v.nombre}! Soy tu asesor de Aprender-Aleman.de 😊 Te espero el ${v.dia} a las ${v.hora} (hora de Berlín) en tu Sesión de Plan-Alemán — 25 minutos y sales con tu plan de alemán listo. ¡Nos vemos en la videollamada!`,
    },
    {
      id: "c2",
      label: "El día de la sesión",
      text: `¡${v.nombre}! Hoy a las ${v.hora} (Berlín) tenemos tu Sesión de Plan-Alemán 😊 Ten a mano tus dudas — en 25 minutos armamos tu plan con fechas y precio claros.`,
    },
  ];
}

const TITLE: Record<Estado, string> = {
  asistio:    "Mensajes de seguimiento (asistió)",
  no_asistio: "Mensajes de rescate (no asistió)",
  pendiente:  "Mensajes de confirmación (sesión pendiente)",
};

export function CloserFollowupMessages({ leadFirstName, whatsapp, estado, metaLabel, sesionAt }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const waDigits = whatsapp?.replace(/\D/g, "") ?? "";

  const hora = sesionAt
    ? new Date(sesionAt).toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })
    : "la hora acordada";
  const dia = sesionAt
    ? new Date(sesionAt).toLocaleDateString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" })
    : "día acordado";

  const messages = buildMessages(
    { nombre: leadFirstName || "¡Hola!", meta: metaLabel, hora, dia },
    estado,
  );

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      // El texto queda visible para copiar a mano
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
