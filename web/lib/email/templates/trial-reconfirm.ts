import { bigButton, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Reconfirmación de clases de prueba reservadas con mucha antelación
 * (Gelfis 2026-11-24). Quien reserva con >7 días de antelación convierte
 * al 2 %, así que 48 h antes le pedimos que confirme. Si no confirma
 * antes del plazo, liberamos el hueco para otro lead.
 *
 *   - renderTrialReconfirmAsk:      48 h antes — "¿sigues contando con tu clase?"
 *   - renderTrialReconfirmReleased: plazo vencido — "hemos liberado tu plaza"
 */

export type TrialReconfirmAskVars = {
  leadName:      string;
  startDate:     string;   // "miércoles, 2 de diciembre, 15:30 (Berlín)"
  deadline:      string;   // "martes, 1 de diciembre, 21:30 (Berlín)"
  confirmUrl:    string;
  rescheduleUrl: string;
};

export function renderTrialReconfirmAsk(v: TrialReconfirmAskVars): RenderedEmail {
  const subject = `${v.leadName}, ¿sigues contando con tu clase de prueba?`;
  const body = `
    ${h2(`¡Hola, ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Tu <strong>clase de prueba de alemán</strong> es el <strong>${escapeHtml(v.startDate)}</strong>.`)}
    ${p(`Como la reservaste hace unos días, queremos asegurarnos de que sigues pudiendo asistir. Confírmalo con un clic:`)}
    ${bigButton(v.confirmUrl, "✅ SÍ, ASISTIRÉ", "confirm")}
    ${p(`Tenemos personas en lista de espera, así que <strong>si no confirmas antes del ${escapeHtml(v.deadline)}</strong>, liberaremos tu plaza para otra persona.`)}
    ${p(`¿Ya no te viene bien esa hora? <a href="${v.rescheduleUrl}">Cámbiala aquí</a>.`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola, ${v.leadName}! 👋`, ``,
    `Tu clase de prueba de alemán es el ${v.startDate}.`, ``,
    `Como la reservaste hace unos días, queremos asegurarnos de que sigues pudiendo asistir. Confírmalo aquí:`,
    `✅ ${v.confirmUrl}`, ``,
    `Tenemos personas en lista de espera, así que si no confirmas antes del ${v.deadline}, liberaremos tu plaza para otra persona.`, ``,
    `¿Ya no te viene bien esa hora? Cámbiala aquí: ${v.rescheduleUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque tienes una clase de prueba agendada con nosotros."),
    text,
  };
}

export type TrialReconfirmReleasedVars = {
  leadName:  string;
  startDate: string;
  bookUrl:   string;
};

export function renderTrialReconfirmReleased(v: TrialReconfirmReleasedVars): RenderedEmail {
  const subject = `Hemos liberado tu plaza, ${v.leadName}`;
  const body = `
    ${h2(`¡Hola, ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Como no recibimos tu confirmación, hemos liberado tu clase de prueba del <strong>${escapeHtml(v.startDate)}</strong> para otra persona de la lista de espera.`)}
    ${p(`Si sigues queriendo aprender alemán, puedes reservar una nueva clase gratuita cuando quieras:`)}
    ${bigButton(v.bookUrl, "📅 RESERVAR NUEVA CLASE", "reschedule")}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `¡Hola, ${v.leadName}! 👋`, ``,
    `Como no recibimos tu confirmación, hemos liberado tu clase de prueba del ${v.startDate} para otra persona de la lista de espera.`, ``,
    `Si sigues queriendo aprender alemán, puedes reservar una nueva clase gratuita cuando quieras:`,
    `👉 ${v.bookUrl}`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Recibes este correo porque tenías una clase de prueba agendada con nosotros."),
    text,
  };
}
