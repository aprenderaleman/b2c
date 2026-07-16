import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email enviado cuando el profesor marca al lead como "No asistió".
 * Gelfis 2026-07-16: en vez de enviar el link directo, primero
 * preguntamos si sigue interesado. Dos botones: SÍ (endpoint que
 * dispara el link por WA) y NO (cierra + marca lost).
 */
export type TrialAbsentFollowupVars = {
  leadName:    string;
  language:    "es" | "de";
  interestYesUrl: string;   // /api/email-action/absent-interest-yes?t=...
  interestNoUrl:  string;   // /api/email-action/absent-interest-no?t=...
};

export function renderTrialAbsentFollowup(v: TrialAbsentFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialAbsentFollowupVars): RenderedEmail {
  const subject = `¿Sigues queriendo aprender alemán, ${v.leadName}?`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Hoy estábamos preparados para tu clase de prueba de alemán pero no pudimos conectarnos contigo. Sin problema — sé que pasan cosas.`)}
    ${p(`<strong>¿Sigues teniendo interés real en aprender alemán? 🇩🇪</strong>`)}
    ${bigButton(v.interestYesUrl, "✅ SÍ, envíame el enlace", "confirm")}
    ${bigButton(v.interestNoUrl, "🚫 NO, ya no me interesa", "reschedule")}
    ${p(`<em style="color:#64748b;font-size:13px;">Si prefieres dejarlo aquí, pulsa NO y no te sigo escribiendo.</em>`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Hoy estábamos preparados para tu clase de prueba pero no pudimos conectarnos contigo. Sin problema — sé que pasan cosas.`, ``,
    `¿Sigues teniendo interés real en aprender alemán?`,
    `✅ Sí, envíame el enlace: ${v.interestYesUrl}`,
    `🚫 No, ya no me interesa: ${v.interestNoUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque tenías una clase de prueba agendada con nosotros."),
    text,
  };
}

function renderDE(v: TrialAbsentFollowupVars): RenderedEmail {
  const subject = `Möchtest du weiterhin Deutsch lernen, ${v.leadName}?`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Wir waren heute für deine Probestunde bereit, konnten dich aber nicht erreichen. Kein Problem — sowas passiert.`)}
    ${p(`<strong>Hast du weiterhin echtes Interesse daran, Deutsch zu lernen? 🇩🇪</strong>`)}
    ${bigButton(v.interestYesUrl, "✅ JA, schick mir den Link", "confirm")}
    ${bigButton(v.interestNoUrl, "🚫 NEIN, kein Interesse mehr", "reschedule")}
    ${p(`<em style="color:#64748b;font-size:13px;">Wenn du lieber Schluss machst, klick auf NEIN und ich schreibe dir nicht mehr.</em>`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Wir waren heute für deine Probestunde bereit, konnten dich aber nicht erreichen.`, ``,
    `Hast du weiterhin Interesse daran, Deutsch zu lernen?`,
    `✅ JA: ${v.interestYesUrl}`,
    `🚫 NEIN: ${v.interestNoUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Du erhältst diese E-Mail, weil du eine Probestunde bei uns gebucht hattest."),
    text,
  };
}
