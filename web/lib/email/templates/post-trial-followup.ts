import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email post-clase de prueba, espejo del WhatsApp que ya se manda en
 * `markTrialAttendedAwaitingConversion`. Mismo wording — copy fijo
 * aprobado por Gelfis: NO modificar sin pedirle antes.
 *
 * Versión personalizada: cuando el admin rellena pack + objetivo en
 * el modal "✓ Asistió". Si no, el caller usa la versión genérica.
 */
export type PostTrialFollowupVars = {
  name:        string;
  objective:   string;     // lo que el lead nos contó como meta
  packName:    string;     // ej. "Pack Inicio (Grupal)"
  packUrl:     string;     // checkout link con override de pago
  language:    "es" | "de";
};

export function renderPostTrialFollowup(v: PostTrialFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

/**
 * Versión genérica — disparada cuando el admin marca "Asistió" sin
 * rellenar el modal (caso poco habitual).
 */
export type PostTrialFollowupGenericVars = {
  name:     string;
  language: "es" | "de";
};

export function renderPostTrialFollowupGeneric(v: PostTrialFollowupGenericVars): RenderedEmail {
  if (v.language === "de") {
    const subject = `Wie war deine Probestunde, ${v.name}? 😊`;
    const body = `
      ${h2(`Hallo ${escapeHtml(v.name)}! 😊`)}
      ${p("Danke, dass du in deiner Probestunde dabei warst!")}
      ${p("Wie hat es dir gefallen? Wenn du weitermachen möchtest, kann ich dir einen persönlichen Plan mit Zeiten und Preis vorbereiten — sag mir einfach Bescheid.")}
      ${p(`<em style="color:#64748b;">Stiv, Aprender-Aleman.de</em>`)}
    `;
    const html = renderEnvelope(body, "Du erhältst diese E-Mail nach deiner Probestunde bei Aprender-Aleman.de.");
    const text = [
      `Hallo ${v.name}! 😊`, ``,
      `Danke, dass du in deiner Probestunde dabei warst!`, ``,
      `Wie hat es dir gefallen? Wenn du weitermachen möchtest, kann ich dir einen persönlichen Plan mit Zeiten und Preis vorbereiten — sag mir einfach Bescheid.`, ``,
      `Stiv, Aprender-Aleman.de`,
    ].join("\n");
    return { subject, html, text };
  }
  const subject = `¿Qué tal tu clase de prueba, ${v.name}? 😊`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}! 😊`)}
    ${p("¡Gracias por asistir a tu clase de prueba de alemán!")}
    ${p("¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.")}
    ${p(`<em style="color:#64748b;">Stiv, Aprender-Aleman.de</em>`)}
  `;
  const html = renderEnvelope(body, "Recibes este correo tras tu clase de prueba en Aprender-Aleman.de.");
  const text = [
    `¡Hola ${v.name}! 😊`, ``,
    `¡Gracias por asistir a tu clase de prueba de alemán!`, ``,
    `¿Qué te pareció? Si te interesa avanzar, te preparo un plan personalizado con horarios y precio exacto — dime cuando quieras seguir.`, ``,
    `Stiv, Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}

/**
 * Email del Mensaje 3 (último) — al liberar el cupo. Mismo wording que
 * el WhatsApp final, firmado por Stiv. Sin botón ni link.
 */
export type PostTrialFinalVars = {
  name:     string;
  language: "es" | "de";
};

export function renderPostTrialFinal(v: PostTrialFinalVars): RenderedEmail {
  if (v.language === "de") {
    const subject = `Letzte Nachricht — wir geben deinen Platz frei`;
    const body = `
      ${h2(`Hallo ${escapeHtml(v.name)},`)}
      ${p("Das ist meine letzte Nachricht von meiner Seite.")}
      ${p("Wir werden deinen Platz in der Akademie an einen anderen Schüler weitergeben. Falls du irgendwann wieder einsteigen möchtest, sind wir hier.")}
      ${p("Viel Erfolg! 🍀")}
      ${p(`<em style="color:#64748b;">Stiv | Aprender-Aleman.de</em>`)}
    `;
    const html = renderEnvelope(body, "Du erhältst diese E-Mail im Rahmen unseres Follow-up bei Aprender-Aleman.de.");
    const text = [
      `Hallo ${v.name},`, ``,
      `Das ist meine letzte Nachricht von meiner Seite.`, ``,
      `Wir werden deinen Platz in der Akademie an einen anderen Schüler weitergeben. Falls du irgendwann wieder einsteigen möchtest, sind wir hier.`, ``,
      `Viel Erfolg! 🍀`, ``,
      `Stiv | Aprender-Aleman.de`,
    ].join("\n");
    return { subject, html, text };
  }
  const subject = `Último mensaje — liberamos tu espacio`;
  const body = `
    ${h2(`Hola ${escapeHtml(v.name)},`)}
    ${p("Último mensaje por mi parte.")}
    ${p("Vamos a liberar tu espacio en la academia para dárselo a otro estudiante. Si en algún momento decides retomar, aquí estaremos.")}
    ${p("¡Mucho éxito! 🍀")}
    ${p(`<em style="color:#64748b;">Stiv | Aprender-Aleman.de</em>`)}
  `;
  const html = renderEnvelope(body, "Recibes este correo como cierre de tu seguimiento en Aprender-Aleman.de.");
  const text = [
    `Hola ${v.name},`, ``,
    `Último mensaje por mi parte.`, ``,
    `Vamos a liberar tu espacio en la academia para dárselo a otro estudiante. Si en algún momento decides retomar, aquí estaremos.`, ``,
    `¡Mucho éxito! 🍀`, ``,
    `Stiv | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}

// ─── Versión personalizada (con pack y objetivo) ─────────────────────

function renderES(v: PostTrialFollowupVars): RenderedEmail {
  const subject = `Tu plan: ${v.packName} — siguiente paso`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}! 😊`)}
    ${p("Ha sido un placer tenerte en la clase de prueba de hoy — qué bueno que la hayas disfrutado.")}
    ${p(`Según tu objetivo (<strong>${escapeHtml(v.objective)}</strong>), el pack que mejor se adapta a ti es el <strong>${escapeHtml(v.packName)}</strong>.`)}
    ${p("Aquí tienes el enlace para formalizar tu inscripción:")}
    <div style="text-align:center;margin:24px 0 28px 0;">${button(v.packUrl, "👉 Inscribirme")}</div>
    ${p("Avísame cuando hayas realizado el pago. Cualquier duda, aquí estoy.")}
    ${p(`<em style="color:#64748b;">Gelfis | Aprender-Aleman.de</em>`)}
  `;
  const html = renderEnvelope(body, "Recibes este correo tras tu clase de prueba en Aprender-Aleman.de.");
  const text = [
    `¡Hola ${v.name}! 😊`, ``,
    `Ha sido un placer tenerte en la clase de prueba de hoy — qué bueno que la hayas disfrutado.`, ``,
    `Según tu objetivo (${v.objective}), el pack que mejor se adapta a ti es el ${v.packName}.`, ``,
    `Aquí tienes el enlace para formalizar tu inscripción:`,
    `👉 ${v.packUrl}`, ``,
    `Avísame cuando hayas realizado el pago. Cualquier duda, aquí estoy.`, ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}

function renderDE(v: PostTrialFollowupVars): RenderedEmail {
  const subject = `Dein Plan: ${v.packName} — nächster Schritt`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.name)}! 😊`)}
    ${p("Es war mir eine Freude, dich heute in der Probestunde dabei zu haben — schön, dass es dir gefallen hat.")}
    ${p(`Basierend auf deinem Ziel (<strong>${escapeHtml(v.objective)}</strong>) passt das Paket <strong>${escapeHtml(v.packName)}</strong> am besten zu dir.`)}
    ${p("Hier dein Anmeldelink:")}
    <div style="text-align:center;margin:24px 0 28px 0;">${button(v.packUrl, "👉 Anmelden")}</div>
    ${p("Sag mir Bescheid, sobald du die Zahlung abgeschlossen hast. Bei Fragen bin ich da.")}
    ${p(`<em style="color:#64748b;">Gelfis | Aprender-Aleman.de</em>`)}
  `;
  const html = renderEnvelope(body, "Du erhältst diese E-Mail nach deiner Probestunde bei Aprender-Aleman.de.");
  const text = [
    `Hallo ${v.name}! 😊`, ``,
    `Es war mir eine Freude, dich heute in der Probestunde dabei zu haben — schön, dass es dir gefallen hat.`, ``,
    `Basierend auf deinem Ziel (${v.objective}) passt das Paket ${v.packName} am besten zu dir.`, ``,
    `Hier dein Anmeldelink:`,
    `👉 ${v.packUrl}`, ``,
    `Sag mir Bescheid, sobald du die Zahlung abgeschlossen hast. Bei Fragen bin ich da.`, ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html, text };
}
