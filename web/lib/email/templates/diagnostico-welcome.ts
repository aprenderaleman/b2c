import { escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email transaccional disparado al completar el paso 5 del nuevo
 * funnel `/`. El lead acaba de dejar sus datos pero todavía NO
 * agendó la clase.
 *
 * Cambio 2026-05-14: en lugar de empujar a la clase de prueba, abrimos
 * conversación con una propuesta de llamada informativa de 15 min con
 * Gelfis. El lead responde por WhatsApp con la hora propuesta y agent_4
 * (handler `_handle_call_time_proposal`) parsea + agenda en Calendar.
 *
 * `bookUrl` se mantiene en la firma por compat, pero no se usa.
 */
export type DiagnosticoWelcomeVars = {
  leadName:  string;          // first name
  bookUrl:   string;          // legacy — ya no se renderiza
  language:  "es" | "de";
};

export function renderDiagnosticoWelcome(v: DiagnosticoWelcomeVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoWelcomeVars): RenderedEmail {
  const subject = `Hablamos 15 minutos, ${v.leadName}?`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Es un gusto saludarte, soy <strong>Stiv de la academia Aprender-Aleman.de</strong>.`)}
    ${p(`Recibimos tu interés para aprender alemán. ¿Te parece si hablamos <strong>15 minutos</strong> para contarte cómo podemos ayudarte a lograrlo?`)}
    ${p(`<strong>¿A qué hora te vendría bien que te llame hoy o mañana?</strong>`)}
    ${p(`Respóndenos por WhatsApp o contestando este correo y te confirmo en cuanto vea hueco en mi agenda.`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque acabas de crear tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Es un gusto saludarte, soy Stiv de la academia Aprender-Aleman.de.`, ``,
    `Recibimos tu interés para aprender alemán. ¿Te parece si hablamos 15 minutos para contarte cómo podemos ayudarte a lograrlo?`, ``,
    `¿A qué hora te vendría bien que te llame hoy o mañana?`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: DiagnosticoWelcomeVars): RenderedEmail {
  const subject = `15 Minuten sprechen, ${v.leadName}?`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Schön, dich kennenzulernen, ich bin <strong>Stiv von der Akademie Aprender-Aleman.de</strong>.`)}
    ${p(`Wir haben dein Interesse am Deutschlernen erhalten. Hast du Lust auf ein kurzes Gespräch von <strong>15 Minuten</strong>, damit ich dir erkläre, wie wir dir helfen können?`)}
    ${p(`<strong>Wann würde es dir heute oder morgen passen, dass ich dich anrufe?</strong>`)}
    ${p(`Antworte per WhatsApp oder direkt auf diese Mail und ich bestätige dir den Termin, sobald ich freie Zeit in meinem Kalender sehe.`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du gerade deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Schön, dich kennenzulernen, ich bin Stiv von der Akademie Aprender-Aleman.de.`, ``,
    `Wir haben dein Interesse am Deutschlernen erhalten. Hast du Lust auf ein 15-Minuten-Gespräch, damit ich dir erkläre, wie wir dir helfen können?`, ``,
    `Wann würde es dir heute oder morgen passen, dass ich dich anrufe?`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
