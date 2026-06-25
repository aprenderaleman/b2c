import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email enviado cuando el profesor marca al lead como "No asistió".
 * Tono empático, sin reproches. El único objetivo es que reagende
 * con un clic vía /agendar/cuando con su id ya pre-rellenado.
 */
export type TrialAbsentFollowupVars = {
  leadName:    string;
  language:    "es" | "de";
  rescheduleUrl: string;
};

export function renderTrialAbsentFollowup(v: TrialAbsentFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialAbsentFollowupVars): RenderedEmail {
  const subject = `${v.leadName}, ¿reagendamos tu clase de prueba?`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Hoy estábamos preparados para tu clase de prueba de alemán pero no pudimos conectarnos contigo. Sin problema — sé que pasan cosas.`)}
    ${p(`<strong>¿Cuándo te viene bien retomarla?</strong> Con un clic eliges un nuevo horario y te asignamos profesor.`)}
    ${bigButton(v.rescheduleUrl, "📅 REAGENDAR MI CLASE", "reschedule")}
    ${p(`<em style="color:#64748b;font-size:13px;">Si prefieres contarme qué pasó o tienes una duda concreta, simplemente responde a este email.</em>`)}
    ${p(`Espero verte pronto.<br><em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Hoy estábamos preparados para tu clase de prueba pero no pudimos conectarnos. Sin problema — sé que pasan cosas.`, ``,
    `¿Cuándo te viene bien retomarla? Reagenda con un clic:`,
    `📅 ${v.rescheduleUrl}`, ``,
    `Si prefieres contarme qué pasó, responde a este email.`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque tenías una clase de prueba agendada con nosotros y queremos ayudarte a retomarla."),
    text,
  };
}

function renderDE(v: TrialAbsentFollowupVars): RenderedEmail {
  const subject = `${v.leadName}, sollen wir deine Probestunde verschieben?`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Wir waren heute für deine Probestunde bereit, konnten dich aber nicht erreichen. Kein Problem — sowas passiert.`)}
    ${p(`<strong>Wann passt es dir besser?</strong> Such dir mit einem Klick einen neuen Termin aus.`)}
    ${bigButton(v.rescheduleUrl, "📅 STUNDE VERSCHIEBEN", "reschedule")}
    ${p(`<em style="color:#64748b;font-size:13px;">Wenn du lieber kurz erzählen willst, was passiert ist, antworte einfach auf diese E-Mail.</em>`)}
    ${p(`Bis bald.<br><em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Wir waren heute für deine Probestunde bereit, konnten dich aber nicht erreichen.`, ``,
    `Wann passt es dir besser? Verschieben mit einem Klick:`,
    `📅 ${v.rescheduleUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Du erhältst diese E-Mail, weil du eine Probestunde bei uns gebucht hattest."),
    text,
  };
}
