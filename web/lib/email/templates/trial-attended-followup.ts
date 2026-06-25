import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email post-trial cuando el lead asistio.
 *
 * Cubre los dos flows con un único template — el botón CTA cambia:
 *  - flow="general": botón a /inscripciones (catálogo de packs)
 *  - flow="inscription_link": botón directo al Stripe checkout del pack
 *    seleccionado por el profesor
 *
 * Se manda inmediatamente después de marcar "Asistió" o "Enviar enlace
 * de inscripción". El cron post-trial-followups encadena los recordatorios
 * de los días siguientes (drip ya existente).
 */
export type TrialAttendedFollowupVars = {
  leadName: string;
  language: "es" | "de";
  ctaUrl:   string;
  /** Solo decide el texto del subject + nombre del pack en el cuerpo
   *  cuando es flow inscription_link. Para general queda undefined. */
  packName?: string;
};

export function renderTrialAttendedFollowup(v: TrialAttendedFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialAttendedFollowupVars): RenderedEmail {
  const subject = v.packName
    ? `Tu plan para seguir aprendiendo alemán — ${v.packName}`
    : `¡Fue un placer tenerte hoy, ${v.leadName}!`;

  const ctaLabel = v.packName
    ? `🚀 INSCRIBIRME · ${v.packName}`
    : `🎓 INSCRIBIRME EN LA ACADEMIA`;

  const intro = v.packName
    ? `Acabas de terminar tu clase de prueba con nosotros. Como hablamos, te dejo el enlace directo para inscribirte en el plan que te recomendamos:`
    : `Acabas de terminar tu clase de prueba con nosotros. Gracias por dedicar este rato — espero que te haya servido para hacerte una idea de cómo trabajamos en la academia.`;

  const middle = v.packName
    ? `Con este plan tendrás tu profesor fijo, materiales, certificado al terminar y el seguimiento de la academia para que no te quedes a medias.`
    : `Si quieres seguir con nosotros, aquí abajo te dejo el enlace para que veas todos los planes disponibles y elijas el que mejor te encaje.`;

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(intro)}
    ${p(`<strong>${escapeHtml(middle)}</strong>`)}
    ${bigButton(v.ctaUrl, ctaLabel, "confirm")}
    ${p(`<em style="color:#64748b;font-size:13px;">Un solo clic y eliges tu plan. Si tienes dudas, respóndeme directamente a este email y te ayudo.</em>`)}
    ${p(`Nos vemos pronto del otro lado.<br><em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    intro, ``, middle, ``,
    `🔗 ${v.ctaUrl}`, ``,
    `Si tienes dudas, responde a este email.`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque acabas de tener tu clase de prueba en Aprender-Aleman.de."),
    text,
  };
}

function renderDE(v: TrialAttendedFollowupVars): RenderedEmail {
  const subject = v.packName
    ? `Dein Plan, um weiterzulernen — ${v.packName}`
    : `Es war mir eine Freude, ${v.leadName}!`;

  const ctaLabel = v.packName
    ? `🚀 JETZT EINSCHREIBEN · ${v.packName}`
    : `🎓 IN DER AKADEMIE EINSCHREIBEN`;

  const intro = v.packName
    ? `Du hast deine Probestunde gerade beendet — und du hast heute richtig stark gezeigt, was du kannst. Hier ist dein direkter Link, um dich für den empfohlenen Plan einzuschreiben:`
    : `Du hast deine Probestunde gerade beendet — und es war eine super Stunde. Du hast gezeigt, dass du Deutsch lernen kannst und willst.`;

  const middle = v.packName
    ? `Mit diesem Plan bekommst du deinen festen Lehrer, Materialien, ein Zertifikat zum Abschluss und die Begleitung der Akademie.`
    : `Wenn du mit uns weitermachen willst, schau dir alle Pläne an und such dir den passenden aus.`;

  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(intro)}
    ${p(`<strong>${escapeHtml(middle)}</strong>`)}
    ${bigButton(v.ctaUrl, ctaLabel, "confirm")}
    ${p(`<em style="color:#64748b;font-size:13px;">Ein Klick reicht. Bei Fragen einfach auf diese E-Mail antworten.</em>`)}
    ${p(`Bis bald!<br><em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `Hallo ${v.leadName}!`, ``,
    intro, ``, middle, ``,
    `🔗 ${v.ctaUrl}`, ``,
    `Bei Fragen einfach antworten.`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Du erhältst diese E-Mail, weil du gerade deine Probestunde bei Aprender-Aleman.de hattest."),
    text,
  };
}
