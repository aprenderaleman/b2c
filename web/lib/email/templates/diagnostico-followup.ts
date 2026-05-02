import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email del drip de leads que registraron en `/` pero no agendaron
 * la clase. Disparado por `/api/cron/diagnostico-followups`.
 *
 * Variants:
 *   - 'reminder_24h': enviado ~24 h después del registro. Tono cálido,
 *     recordatorio de que el plan sigue disponible.
 *   - 'final_7d': enviado ~7 días después. Último contacto. Tono
 *     "aquí seguimos cuando quieras", sin presión. Lead pasa a 'cold'.
 */
export type DiagnosticoFollowupVars = {
  leadName: string;
  bookUrl:  string;
  language: "es" | "de";
  variant:  "reminder_24h" | "final_7d";
};

export function renderDiagnosticoFollowup(v: DiagnosticoFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoFollowupVars): RenderedEmail {
  if (v.variant === "reminder_24h") {
    const subject = `Tu clase de prueba sigue disponible`;
    const body = `
      ${h2(`Hola ${escapeHtml(v.leadName)} 👋`)}
      ${p(`Tu <strong>plan personalizado de alemán</strong> sigue esperándote, y tu <strong>clase de prueba GRATIS de 30 min</strong> también.`)}
      <div style="text-align:center;margin:20px 0 8px 0;">
        ${button(v.bookUrl, "Agendar ahora →")}
      </div>
      ${p(`Si tienes dudas con el horario o cualquier otra cosa, responde a este correo y te ayudo.`)}
      ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
    `;
    const text = [
      `Hola ${v.leadName}`, ``,
      `Tu plan personalizado de alemán sigue esperándote, y tu clase de prueba GRATIS de 30 min también.`, ``,
      `Agendar ahora: ${v.bookUrl}`, ``,
      `Si tienes dudas con el horario o cualquier otra cosa, responde a este correo y te ayudo.`, ``,
      `— Aprender-Aleman.de`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Recibes este correo porque creaste tu plan en Aprender-Aleman.de."),
      text,
    };
  }
  // final_7d
  const subject = `Aquí seguimos cuando quieras`;
  const body = `
    ${h2(`${escapeHtml(v.leadName)},`)}
    ${p(`No te queremos saturar. Si por ahora no es el momento de empezar, totalmente entendible.`)}
    ${p(`Cuando quieras, tu plan y tu clase de prueba siguen aquí:`)}
    <div style="text-align:center;margin:20px 0 8px 0;">
      ${button(v.bookUrl, "Agendar mi clase de prueba")}
    </div>
    ${p(`Mucha suerte con tu alemán — sea con nosotros o no.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `${v.leadName},`, ``,
    `No te queremos saturar. Si por ahora no es el momento de empezar, totalmente entendible.`, ``,
    `Cuando quieras, tu plan y tu clase de prueba siguen aquí:`,
    v.bookUrl, ``,
    `Mucha suerte con tu alemán — sea con nosotros o no.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Último contacto sobre tu plan en Aprender-Aleman.de."),
    text,
  };
}

function renderDE(v: DiagnosticoFollowupVars): RenderedEmail {
  if (v.variant === "reminder_24h") {
    const subject = `Deine Probestunde wartet noch auf dich`;
    const body = `
      ${h2(`Hallo ${escapeHtml(v.leadName)} 👋`)}
      ${p(`Dein <strong>persönlicher Deutschplan</strong> wartet auf dich, und deine <strong>kostenlose 30-Minuten-Probestunde</strong> auch.`)}
      <div style="text-align:center;margin:20px 0 8px 0;">
        ${button(v.bookUrl, "Jetzt buchen →")}
      </div>
      ${p(`Wenn du Fragen zur Uhrzeit oder anderem hast, antworte einfach auf diese E-Mail.`)}
      ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
    `;
    const text = [
      `Hallo ${v.leadName}`, ``,
      `Dein persönlicher Deutschplan wartet auf dich, und deine kostenlose 30-Minuten-Probestunde auch.`, ``,
      `Jetzt buchen: ${v.bookUrl}`, ``,
      `— Aprender-Aleman.de`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Du erhältst diese E-Mail wegen deines Plans auf Aprender-Aleman.de."),
      text,
    };
  }
  const subject = `Wir sind hier, wenn du soweit bist`;
  const body = `
    ${h2(`${escapeHtml(v.leadName)},`)}
    ${p(`Wir wollen dich nicht überlasten. Wenn jetzt nicht der richtige Moment ist, ist das völlig okay.`)}
    ${p(`Wann immer du soweit bist, dein Plan und deine Probestunde warten hier:`)}
    <div style="text-align:center;margin:20px 0 8px 0;">
      ${button(v.bookUrl, "Probestunde buchen")}
    </div>
    ${p(`Viel Erfolg mit deinem Deutsch — mit oder ohne uns.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const text = [
    `${v.leadName},`, ``,
    `Wir wollen dich nicht überlasten. Wenn jetzt nicht der richtige Moment ist, ist das völlig okay.`, ``,
    `Wann immer du soweit bist:`,
    v.bookUrl, ``,
    `Viel Erfolg!`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return {
    subject,
    html: renderEnvelope(body, "Letzte E-Mail zu deinem Plan auf Aprender-Aleman.de."),
    text,
  };
}
