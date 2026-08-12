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
  // Variantes (Gelfis 2026-06-14, drip 8-msg):
  //   reminder_24h / final_7d → legacy, conservados por compat.
  //   binary_question         → msg 7, pregunta sí/no sincera.
  //   final_goodbye           → msg 8, despedida sin presión, status=lost.
  variant:  "reminder_24h" | "final_7d" | "binary_question" | "final_goodbye";
};

export function renderDiagnosticoFollowup(v: DiagnosticoFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoFollowupVars): RenderedEmail {
  // ── Msg 7 — pregunta sí/no honesta ───────────────────────
  if (v.variant === "binary_question") {
    const subject = `${v.leadName}, ¿una última pregunta?`;
    const body = `
      ${h2(`Hola ${escapeHtml(v.leadName)},`)}
      ${p(`Solo una pregunta honesta:`)}
      ${p(`<strong>→ ¿Sigues queriendo aprender alemán?</strong>`)}
      ${p(`Si <strong>SÍ</strong>: déjame ayudarte.`)}
      <div style="text-align:center;margin:18px 0 8px 0;">
        ${button(v.bookUrl, "Agendar 40 min gratis →")}
      </div>
      ${p(`Si <strong>NO</strong>: respóndeme a este correo y te quito de la lista. No problem.`)}
      ${p(`Tu respuesta sincera me ayuda.`)}
      ${p(`<em style="color:#64748b;">Stiv</em>`)}
    `;
    const text = [
      `Hola ${v.leadName},`, ``,
      `Solo una pregunta honesta:`, ``,
      `→ ¿Sigues queriendo aprender alemán?`, ``,
      `Si SÍ: agenda 40 min gratis → ${v.bookUrl}`,
      `Si NO: respóndeme a este correo y te quito de la lista. No problem.`, ``,
      `Tu respuesta sincera me ayuda.`, ``,
      `Stiv`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Pregunta directa sobre tu plan en Aprender-Aleman.de."),
      text,
    };
  }
  // ── Msg 8 — despedida final, lead pasa a 'lost' ──────────
  if (v.variant === "final_goodbye") {
    const subject = `${v.leadName}, último mensaje`;
    const body = `
      ${h2(`${escapeHtml(v.leadName)},`)}
      ${p(`Te voy a dejar de escribir porque entiendo que no es tu momento.`)}
      ${p(`Cuando estés listo, aquí estaré:`)}
      <div style="text-align:center;margin:18px 0 8px 0;">
        ${button(v.bookUrl, "Agendar mi clase de prueba")}
      </div>
      ${p(`Mucho éxito con el alemán, lo logres con nosotros o no.`)}
      ${p(`<em style="color:#64748b;">Stiv 🇩🇪</em>`)}
    `;
    const text = [
      `${v.leadName},`, ``,
      `Te voy a dejar de escribir porque entiendo que no es tu momento.`, ``,
      `Cuando estés listo, aquí estaré:`,
      v.bookUrl, ``,
      `Mucho éxito con el alemán, lo logres con nosotros o no.`, ``,
      `Stiv`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Último contacto sobre tu plan en Aprender-Aleman.de."),
      text,
    };
  }
  if (v.variant === "reminder_24h") {
    const subject = `Tu clase de prueba sigue disponible`;
    const body = `
      ${h2(`Hola ${escapeHtml(v.leadName)} 👋`)}
      ${p(`Tu <strong>plan personalizado de alemán</strong> sigue esperándote, y tu <strong>clase de prueba GRATIS de 40 min</strong> también.`)}
      <div style="text-align:center;margin:20px 0 8px 0;">
        ${button(v.bookUrl, "Agendar ahora →")}
      </div>
      ${p(`Si tienes dudas con el horario o cualquier otra cosa, responde a este correo y te ayudo.`)}
      ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
    `;
    const text = [
      `Hola ${v.leadName}`, ``,
      `Tu plan personalizado de alemán sigue esperándote, y tu clase de prueba GRATIS de 40 min también.`, ``,
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
  // ── Msg 7 — binäre Frage ─────────────────────────────────
  if (v.variant === "binary_question") {
    const subject = `${v.leadName}, eine letzte Frage?`;
    const body = `
      ${h2(`Hallo ${escapeHtml(v.leadName)},`)}
      ${p(`Nur eine ehrliche Frage:`)}
      ${p(`<strong>→ Willst du immer noch Deutsch lernen?</strong>`)}
      ${p(`Wenn <strong>JA</strong>: lass mich dir helfen.`)}
      <div style="text-align:center;margin:18px 0 8px 0;">
        ${button(v.bookUrl, "40 Min gratis buchen →")}
      </div>
      ${p(`Wenn <strong>NEIN</strong>: antworte auf diese Mail und ich nehme dich von der Liste. Kein Problem.`)}
      ${p(`<em style="color:#64748b;">Stiv</em>`)}
    `;
    const text = [
      `Hallo ${v.leadName},`, ``,
      `→ Willst du immer noch Deutsch lernen?`, ``,
      `JA → ${v.bookUrl}`,
      `NEIN → antworte einfach und ich nehme dich von der Liste.`, ``,
      `Stiv`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Direkte Frage zu deinem Plan auf Aprender-Aleman.de."),
      text,
    };
  }
  // ── Msg 8 — letzter Abschied ─────────────────────────────
  if (v.variant === "final_goodbye") {
    const subject = `${v.leadName}, letzte Nachricht`;
    const body = `
      ${h2(`${escapeHtml(v.leadName)},`)}
      ${p(`Ich werde dir nicht mehr schreiben — ich verstehe, dass es jetzt nicht dein Moment ist.`)}
      ${p(`Wenn du soweit bist, bin ich hier:`)}
      <div style="text-align:center;margin:18px 0 8px 0;">
        ${button(v.bookUrl, "Probestunde buchen")}
      </div>
      ${p(`Viel Erfolg mit Deutsch — mit oder ohne uns.`)}
      ${p(`<em style="color:#64748b;">Stiv 🇩🇪</em>`)}
    `;
    const text = [
      `${v.leadName},`, ``,
      `Ich werde dir nicht mehr schreiben.`, ``,
      `Wenn du soweit bist: ${v.bookUrl}`, ``,
      `Stiv`,
    ].join("\n");
    return {
      subject,
      html: renderEnvelope(body, "Letzte E-Mail zu deinem Plan auf Aprender-Aleman.de."),
      text,
    };
  }
  if (v.variant === "reminder_24h") {
    const subject = `Deine Probestunde wartet noch auf dich`;
    const body = `
      ${h2(`Hallo ${escapeHtml(v.leadName)} 👋`)}
      ${p(`Dein <strong>persönlicher Deutschplan</strong> wartet auf dich, und deine <strong>kostenlose 40-Minuten-Probestunde</strong> auch.`)}
      <div style="text-align:center;margin:20px 0 8px 0;">
        ${button(v.bookUrl, "Jetzt buchen →")}
      </div>
      ${p(`Wenn du Fragen zur Uhrzeit oder anderem hast, antworte einfach auf diese E-Mail.`)}
      ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
    `;
    const text = [
      `Hallo ${v.leadName}`, ``,
      `Dein persönlicher Deutschplan wartet auf dich, und deine kostenlose 40-Minuten-Probestunde auch.`, ``,
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
