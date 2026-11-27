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
  /** Nombre de pila del closer — firma los mensajes (Gelfis 2026-11-27) */
  closerFirstName?: string;
  /** ISO de la asistencia al trial — calcula el vencimiento del bono */
  trialAttendedAt?: string | null;
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

type MsgVars = {
  nombre: string;
  meta: string;
  hora: string;
  dia: string;
  /** Nombre de pila del closer */
  closer: string;
  /** Firma: "— Iván, Aprender-Aleman.de" */
  firma: string;
  /** "el viernes 28 de noviembre a las 15:30" — null si el bono ya venció */
  vencimiento: string | null;
};

// Copys estilo Hormozi aprobados por Gelfis el 2026-11-27: urgencia solo
// donde es verdad (el bono), resultado soñado con SU meta, esfuerzo
// mínimo y cierres sin presión. Voz de clase de prueba (el flujo del CRM),
// firmados por el closer. Cambios de copy: editar aquí.
function buildMessages(v: MsgVars, estado: Estado) {
  if (estado === "asistio") {
    return [
      {
        id: "a1",
        label: "Mismo día — gracias + bono",
        text: v.vencimiento
          ? `¡Hola ${v.nombre}! Soy ${v.closer}, de Aprender-Aleman.de 😊 Vi que tuviste tu clase de prueba — ¿qué te pareció? Te recuerdo que tu Bono de Acción Rápida está activo hasta ${v.vencimiento}: todas tus clases grabadas, la Serie completa y una clase extra de conversación, gratis al inscribirte. Si tienes cualquier duda con el plan o el pago, escríbeme por aquí y lo resolvemos en un minuto.\n${v.firma}`
          : `¡Hola ${v.nombre}! Soy ${v.closer}, de Aprender-Aleman.de 😊 Vi que tuviste tu clase de prueba — ¿qué te pareció? Si tienes cualquier duda con el plan o el pago, escríbeme por aquí y lo resolvemos en un minuto.\n${v.firma}`,
      },
      {
        id: "a2",
        label: "Bono por vencer — urgencia real",
        text: v.vencimiento
          ? `${v.nombre}, dato importante: tu bono vence ${v.vencimiento} y no puedo extenderlo. Después de esa hora el plan sigue disponible, pero los regalos (grabaciones + Serie + clase de conversación) ya no entran. Si quieres ${v.meta}, este es el momento con más a tu favor. ¿Te mando el enlace y lo dejamos listo?\n${v.firma}`
          : `${v.nombre}, tu plan sigue disponible tal como lo armó tu profe. Si quieres ${v.meta}, cuanto antes empieces, antes llegas. ¿Te mando el enlace y lo dejamos listo?\n${v.firma}`,
      },
      {
        id: "a3",
        label: "Cierre suave — puerta abierta",
        text: `${v.nombre}, no te insisto más 😊 Tu plan queda guardado tal como lo armó tu profe. Cuando decidas dar el paso hacia ${v.meta}, me escribes y lo activamos ese mismo día. ¡Éxitos! 🍀\n${v.firma}`,
      },
    ];
  }
  if (estado === "no_asistio") {
    return [
      {
        id: "b1",
        label: "Mismo día — cero reproche, reagendar",
        text: `¡Hola ${v.nombre}! Soy ${v.closer}, de Aprender-Aleman.de 😊 Vi que no pudiste conectarte a tu clase de prueba — tranquilo, pasa. Tu espacio sigue reservado: dime qué día y hora te van mejor y te la dejo agendada en un minuto.\n${v.firma}`,
      },
      {
        id: "b2",
        label: "Día siguiente — reaviva la meta",
        text: `${v.nombre}, cuando te apuntaste dijiste que querías ${v.meta} — eso sigue ahí, ¿no? La clase de prueba es gratis, son 50 minutos con un profe en vivo, y sales sabiendo exactamente tu nivel y tu plan. ¿Te busco hueco hoy o mañana?\n${v.firma}`,
      },
      {
        id: "b3",
        label: "Cierre suave",
        text: `Última de mi parte, ${v.nombre} 😊 Tu clase queda guardada. Cuando tengas 50 minutos para ${v.meta}, me escribes y te la agendo — sin vueltas. ¡Que vaya bien! 🍀\n${v.firma}`,
      },
    ];
  }
  // pendiente (voz de Sesión de Plan — flujo /sesion-plan, sin cambios)
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

/** Set "No contesta" (Gelfis 2026-11-27): siempre visible bajo el set del estado. */
function buildNoContestaMessages(v: MsgVars) {
  return [
    {
      id: "n1",
      label: "Tras la llamada perdida",
      text: `¡Hola ${v.nombre}! Soy ${v.closer}, de Aprender-Aleman.de 😊 Te acabo de llamar por tu clase de prueba — nada de ventas raras: quiero resolver tus dudas y dejarte el plan claro para ${v.meta}. ¿A qué hora te viene bien que te llame? También podemos resolverlo por aquí si lo prefieres.\n${v.firma}`,
    },
    {
      id: "n2",
      label: "Segundo intento",
      text: v.vencimiento
        ? `${v.nombre}, te intenté llamar de nuevo 📞 Solo necesito 5 minutos. Ojo: tu Bono de Acción Rápida vence ${v.vencimiento} y me daría pena que lo pierdas por no coincidir. Dime una hora y te llamo puntual — o escríbeme por aquí y lo vemos por chat.\n${v.firma}`
        : `${v.nombre}, te intenté llamar de nuevo 📞 Solo necesito 5 minutos para dejarte el plan claro, sin compromiso. Dime una hora y te llamo puntual — o escríbeme por aquí y lo vemos por chat.\n${v.firma}`,
    },
  ];
}

const TITLE: Record<Estado, string> = {
  asistio:    "Mensajes de seguimiento (asistió)",
  no_asistio: "Mensajes de rescate (no asistió)",
  pendiente:  "Mensajes de confirmación (sesión pendiente)",
};

const BONO_MS = 48 * 3_600_000;

export function CloserFollowupMessages({ leadFirstName, whatsapp, estado, metaLabel, sesionAt, closerFirstName, trialAttendedAt }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const waDigits = whatsapp?.replace(/\D/g, "") ?? "";

  const hora = sesionAt
    ? new Date(sesionAt).toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })
    : "la hora acordada";
  const dia = sesionAt
    ? new Date(sesionAt).toLocaleDateString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" })
    : "día acordado";

  // Vencimiento del bono (asistencia + 48h): solo si sigue vivo.
  const bonoFin = trialAttendedAt ? new Date(trialAttendedAt).getTime() + BONO_MS : null;
  const vencimiento = bonoFin && bonoFin > Date.now()
    ? `el ${new Date(bonoFin).toLocaleDateString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long" })} a las ${new Date(bonoFin).toLocaleTimeString("es-ES", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" })} (hora de Berlín)`
    : null;

  const closer = (closerFirstName ?? "").trim().split(/\s+/)[0] || "tu asesor";
  const vars: MsgVars = {
    nombre: leadFirstName || "¡Hola!",
    meta: metaLabel,
    hora,
    dia,
    closer,
    firma: `— ${closer}, Aprender-Aleman.de`,
    vencimiento,
  };

  const messages = buildMessages(vars, estado);
  // "No contesta" siempre disponible bajo el set del estado (salvo en
  // pendiente, que es del flujo de sesión).
  const noContesta = estado === "pendiente" ? [] : buildNoContestaMessages(vars);

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
        Son una base: adapta el mensaje al lead si hace falta (lo que te dijo,
        su situación, las notas del profe).
      </p>

      <div className="mt-3 space-y-3">
        {[...messages, ...noContesta].map((m, i) => (
          <div key={m.id}>
            {noContesta.length > 0 && i === messages.length && (
              <p className="mb-2 mt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                📵 Si no contesta la llamada
              </p>
            )}
            <MsgCard m={m} copied={copied} copy={copy} waDigits={waDigits} />
          </div>
        ))}
      </div>
    </section>
  );
}

function MsgCard({ m, copied, copy, waDigits }: {
  m: { id: string; label: string; text: string };
  copied: string | null;
  copy: (id: string, text: string) => void;
  waDigits: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-3">
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
  );
}
