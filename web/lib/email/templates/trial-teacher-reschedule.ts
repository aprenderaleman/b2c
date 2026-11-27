import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";
import type { TeacherRescheduleReason } from "@/lib/trial-reschedule-reason";

/**
 * Email al lead cuando el profe reagenda su clase de prueba indicando el
 * motivo (Gelfis 2026-11-27). Es el respaldo del WhatsApp
 * (buildTeacherRescheduleLeadMessage): mismo contenido por motivo, con
 * botón. El motivo escrito por el profe NUNCA viaja al lead.
 */
export type TeacherRescheduleEmailVars = {
  reason:           TeacherRescheduleReason;
  leadName:         string;
  teacherFirstName: string | null;
  whenText:         string;   // "miércoles, 3 de diciembre, 15:00 (Berlín)"
  rescheduleUrl:    string;
};

type Parts = { subject: string; intro: string[]; cta: string; outro: string[] };

function parts(v: TeacherRescheduleEmailVars): Parts {
  const when = v.whenText;
  if (v.reason === "lead_no_confirmo") {
    const con = v.teacherFirstName ? ` con ${v.teacherFirstName}` : "";
    return {
      subject: `Hemos liberado tu clase de prueba, ${v.leadName}`,
      intro: [
        `Te escribimos para confirmar tu clase de prueba del ${when}${con} y no recibimos respuesta, así que liberamos ese horario.`,
        `Si sigues queriendo tu clase, elige nueva fecha aquí:`,
      ],
      cta: "📅 ELEGIR NUEVA FECHA",
      outro: [`Cuando te escribamos para confirmar, respóndenos con un "Sí" y tu lugar queda asegurado 🙌`],
    };
  }
  if (v.reason === "lead_cancelo") {
    return {
      subject: `Elige una nueva fecha para tu clase de prueba, ${v.leadName}`,
      intro: [
        `Gracias por avisarnos que no podrás venir a tu clase de prueba del ${when}. ¡No pasa nada! Ya liberamos ese horario.`,
        `Cuando te venga bien, elige una nueva fecha aquí:`,
      ],
      cta: "📅 ELEGIR NUEVA FECHA",
      outro: [`Tu clase gratuita te sigue esperando, avísame por favor cuando hayas agendado 🙌`],
    };
  }
  const quien = v.teacherFirstName ?? "tu profesor/a";
  return {
    subject: `Tenemos que cambiar tu clase de prueba, ${v.leadName}`,
    intro: [
      `Te pedimos disculpas: ${quien} no podrá darte la clase de prueba del ${when} por un imprevisto.`,
      `Elige aquí el horario que mejor te venga y te guardamos el lugar:`,
    ],
    cta: "📅 ELEGIR NUEVO HORARIO",
    outro: [`Gracias por tu comprensión. ¡Nos vemos muy pronto!`],
  };
}

export function renderTeacherRescheduleEmail(v: TeacherRescheduleEmailVars): RenderedEmail {
  const pt = parts(v);
  const hola = v.leadName ? `¡Hola, ${v.leadName}! 👋` : "¡Hola! 👋";
  const body = `
    ${h2(escapeHtml(hola))}
    ${pt.intro.map(t => p(escapeHtml(t))).join("\n")}
    ${bigButton(v.rescheduleUrl, pt.cta, "reschedule")}
    ${pt.outro.map(t => p(escapeHtml(t))).join("\n")}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    hola, ``,
    pt.intro[0], ``,
    pt.intro[1],
    `👉 ${v.rescheduleUrl}`, ``,
    ...pt.outro, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject: pt.subject,
    html: renderEnvelope(body, "Recibes este correo porque tenías una clase de prueba agendada con nosotros."),
    text,
  };
}
