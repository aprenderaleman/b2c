import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email transaccional disparado al completar el paso 5 del nuevo
 * funnel `/`. El lead acaba de dejar sus datos pero todavía NO
 * agendó la clase. Este email es el primer touchpoint y el "punto
 * de regreso" — si abandonan en el paso 6 (calendario) pueden volver
 * desde el botón del email.
 *
 * Tono: breve, sin marketing-speak, alineado con el tono actual de
 * los WhatsApp post-booking. Bilingüe es/de según preferencia.
 */
export type DiagnosticoWelcomeVars = {
  leadName:  string;          // first name
  bookUrl:   string;          // https://aprender-aleman.de/agendar/cuando
  language:  "es" | "de";
};

export function renderDiagnosticoWelcome(v: DiagnosticoWelcomeVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoWelcomeVars): RenderedEmail {
  const subject = `Tu plan personalizado de alemán está listo, ${v.leadName}`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Hemos creado tu <strong>plan personalizado de alemán</strong> según las respuestas que nos diste.`)}
    ${p(`Para empezar, te invitamos a una <strong>clase de prueba GRATIS de 30 minutos</strong> con un profesor nativo. Te ayudará a poner el plan en marcha.`)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.bookUrl, "Agendar mi clase de prueba →")}
    </div>
    ${p(`<em style="color:#64748b;">Si no agendas hoy, este enlace seguirá funcionando — guárdalo y entra cuando puedas.</em>`)}
    ${p(`¡Te esperamos!`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque acabas de crear tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Hemos creado tu plan personalizado de alemán según las respuestas que nos diste.`, ``,
    `Para empezar, te invitamos a una clase de prueba GRATIS de 30 minutos con un profesor nativo.`, ``,
    `Agendar mi clase de prueba: ${v.bookUrl}`, ``,
    `Si no agendas hoy, este enlace seguirá funcionando — guárdalo y entra cuando puedas.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: DiagnosticoWelcomeVars): RenderedEmail {
  const subject = `Dein persönlicher Deutschplan ist fertig, ${v.leadName}`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Wir haben deinen <strong>persönlichen Deutschplan</strong> erstellt — basierend auf deinen Antworten.`)}
    ${p(`Als Start laden wir dich zu einer <strong>kostenlosen 30-Minuten-Probestunde</strong> mit einer muttersprachlichen Lehrkraft ein.`)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.bookUrl, "Probestunde buchen →")}
    </div>
    ${p(`<em style="color:#64748b;">Wenn du heute nicht buchst, bleibt der Link aktiv — speichere ihn und buche, wann es dir passt.</em>`)}
    ${p(`Wir freuen uns auf dich!`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du gerade deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Wir haben deinen persönlichen Deutschplan erstellt — basierend auf deinen Antworten.`, ``,
    `Als Start laden wir dich zu einer kostenlosen 30-Minuten-Probestunde ein.`, ``,
    `Probestunde buchen: ${v.bookUrl}`, ``,
    `Wenn du heute nicht buchst, bleibt der Link aktiv.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
