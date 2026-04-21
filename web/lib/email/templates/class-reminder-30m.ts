import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Reminder sent ~30 min before a class starts.
 *
 * Single per-class email (no WhatsApp, no second reminder window) —
 * Gelfis explicitly asked to consolidate down to one channel and one
 * notification per class so we don't spam students with 4 pings.
 *
 * Same template for teacher and students, with `partner` adapted by
 * the caller: students see "con Sabine"; teachers see "con Maria,
 * Juan" (the group). Bilingual.
 */
export type ClassReminder30mVars = {
  name:        string;                  // recipient first name
  classTitle:  string;
  startTime:   string;                  // pre-formatted "10:30 (Berlín)"
  partner:     string;                  // "Sabine" or "Maria, Juan"
  classUrl:    string;                  // absolute https://b2c.../aula/{id}
  language:    "es" | "de";
};

export function renderClassReminder30m(v: ClassReminder30mVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: ClassReminder30mVars): RenderedEmail {
  const subject = `⏰ Tu clase empieza en 30 minutos`;
  const body = `
    ${h2(`Hola ${escapeHtml(v.name)} 👋`)}
    ${p(`Tu clase <strong>${escapeHtml(v.classTitle)}</strong> empieza en 30 minutos.`)}
    ${kvBlock([
      ["🕒 Hora",  escapeHtml(v.startTime)],
      ["👥 Con",   escapeHtml(v.partner)],
    ])}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.classUrl, "Entrar al aula →")}
    </div>
    ${p(`Si tienes algún problema para conectarte, avísanos respondiendo a este correo.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque tienes una clase agendada en Aprender-Aleman.de.";
  const text = [
    `Hola ${v.name}!`,
    ``,
    `Tu clase "${v.classTitle}" empieza en 30 minutos.`,
    `Hora: ${v.startTime}`,
    `Con: ${v.partner}`,
    ``,
    `Entrar al aula: ${v.classUrl}`,
    ``,
    `Si tienes algún problema, responde a este correo.`,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: ClassReminder30mVars): RenderedEmail {
  const subject = `⏰ Dein Unterricht beginnt in 30 Minuten`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.name)} 👋`)}
    ${p(`Dein Unterricht <strong>${escapeHtml(v.classTitle)}</strong> beginnt in 30 Minuten.`)}
    ${kvBlock([
      ["🕒 Uhrzeit", escapeHtml(v.startTime)],
      ["👥 Mit",     escapeHtml(v.partner)],
    ])}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.classUrl, "Zum Klassenzimmer →")}
    </div>
    ${p(`Falls du Probleme beim Verbinden hast, antworte einfach auf diese E-Mail.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du eine geplante Stunde auf Aprender-Aleman.de hast.";
  const text = [
    `Hallo ${v.name}!`,
    ``,
    `Dein Unterricht "${v.classTitle}" beginnt in 30 Minuten.`,
    `Uhrzeit: ${v.startTime}`,
    `Mit: ${v.partner}`,
    ``,
    `Zum Klassenzimmer: ${v.classUrl}`,
    ``,
    `Bei Problemen, antworte auf diese E-Mail.`,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
