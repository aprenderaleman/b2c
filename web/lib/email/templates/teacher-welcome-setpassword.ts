import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type TeacherWelcomeSetPasswordVars = {
  name:        string;
  email:       string;
  /** Enlace de creación de contraseña (token de un solo uso). */
  setPasswordUrl: string;
  /** Días de validez del enlace, para el copy. */
  validDays:   number;
  language:    "es" | "de";
  /** Guía de primeros pasos en la academia (Google Doc). */
  onboardingDocUrl: string;
  /** true si el Acuerdo de Colaboración (PDF) va adjunto en este correo. */
  agreementAttached?: boolean;
};

/**
 * Bienvenida al profesor aprobado — con enlace de creación de
 * contraseña en vez de contraseña temporal en texto plano
 * (rediseño Gelfis 2026-08-02).
 */
export function renderTeacherWelcomeSetPassword(v: TeacherWelcomeSetPasswordVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TeacherWelcomeSetPasswordVars): RenderedEmail {
  const subject = "¡Bienvenido al equipo! Activa tu cuenta de profesor 🎉";

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}!`)}
    ${p(`Tu registro fue aprobado — ya eres parte del equipo de profesores de <strong>Aprender-Aleman.de</strong>.`)}
    ${p(`Para activar tu cuenta, crea tu contraseña con este enlace:`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(v.setPasswordUrl, "Crear mi contraseña →")}
    </div>
    ${kvBlock([
      ["Tu usuario", escapeHtml(v.email)],
    ])}
    ${p(`<em style="color:#64748b;">El enlace es personal y válido ${v.validDays} días. Si caduca, usa "¿Olvidaste tu contraseña?" en la pantalla de login.</em>`)}
    ${p(`Dentro encontrarás tu agenda, tus clases y tu panel de ganancias con tus condiciones ya configuradas.`)}
    ${h2(`Tus primeros pasos en la academia`)}
    ${p(`Antes de tu primera clase, lee la guía de bienvenida: cómo funciona la plataforma, cómo damos las clases de prueba, cómo se agendan y cierran las clases, el chat con los alumnos y cómo se calcula tu pago.`)}
    <div style="text-align:center;margin:18px 0 20px 0;">
      ${button(v.onboardingDocUrl, "Abrir la guía de primeros pasos →")}
    </div>
    ${p(`<em style="color:#64748b;">Guárdala: la iremos actualizando y siempre estará en este mismo enlace.</em>`)}
    ${v.agreementAttached ? `
    ${h2(`Tu Acuerdo de Colaboración`)}
    ${p(`Adjunto a este correo tienes tu <strong>Acuerdo de Colaboración</strong> en PDF, ya con tus datos y tu tarifa. Léelo con calma: recoge cómo trabajamos, cómo y cuándo cobras, las cancelaciones y la Garantía de Nivel. Si estás de acuerdo, respóndenos a este correo con el PDF firmado (vale una firma digital o una foto del documento firmado). Si tienes cualquier duda, escríbenos antes de firmar.`)}
    ` : ``}
    ${p(`<em style="color:#64748b;">El equipo de Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Recibes este correo porque tu cuenta de profesor en Aprender-Aleman.de fue aprobada.";

  const text = [
    `¡Hola ${v.name}!`,
    ``,
    `Tu registro fue aprobado — ya eres parte del equipo de profesores de Aprender-Aleman.de.`,
    ``,
    `Crea tu contraseña aquí (válido ${v.validDays} días):`,
    v.setPasswordUrl,
    ``,
    `Tu usuario: ${v.email}`,
    ``,
    `Si el enlace caduca, usa "¿Olvidaste tu contraseña?" en el login.`,
    ``,
    `TUS PRIMEROS PASOS EN LA ACADEMIA`,
    `Antes de tu primera clase, lee la guía de bienvenida (plataforma, clases de prueba, agenda, chat y pagos):`,
    v.onboardingDocUrl,
    ``,
    ...(v.agreementAttached ? [
      `TU ACUERDO DE COLABORACIÓN`,
      `Adjunto va tu Acuerdo de Colaboración en PDF con tus datos y tu tarifa. Léelo y, si estás de acuerdo, respóndenos con el PDF firmado.`,
      ``,
    ] : []),
    `El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TeacherWelcomeSetPasswordVars): RenderedEmail {
  const subject = "Willkommen im Team! Aktiviere dein Lehrerkonto 🎉";

  const body = `
    ${h2(`Hallo ${escapeHtml(v.name)}!`)}
    ${p(`Deine Registrierung wurde bestätigt — du bist jetzt Teil des Lehrerteams von <strong>Aprender-Aleman.de</strong>.`)}
    ${p(`Um dein Konto zu aktivieren, erstelle dein Passwort über diesen Link:`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(v.setPasswordUrl, "Passwort erstellen →")}
    </div>
    ${kvBlock([
      ["Dein Benutzer", escapeHtml(v.email)],
    ])}
    ${p(`<em style="color:#64748b;">Der Link ist persönlich und ${v.validDays} Tage gültig. Falls er abläuft, nutze "Passwort vergessen?" auf der Login-Seite.</em>`)}
    ${h2(`Deine ersten Schritte in der Akademie`)}
    ${p(`Lies vor deiner ersten Stunde den Willkommensleitfaden: Plattform, Probestunden, Terminplanung, Chat mit den Lernenden und Abrechnung.`)}
    <div style="text-align:center;margin:18px 0 20px 0;">
      ${button(v.onboardingDocUrl, "Leitfaden öffnen →")}
    </div>
    ${v.agreementAttached ? `
    ${h2(`Deine Kooperationsvereinbarung`)}
    ${p(`Im Anhang findest du deine <strong>Kooperationsvereinbarung</strong> als PDF, bereits mit deinen Daten und deinem Honorar. Lies sie in Ruhe: Sie beschreibt die Zusammenarbeit, die Abrechnung, Absagen und die Niveau-Garantie. Wenn du einverstanden bist, antworte auf diese E-Mail mit dem unterschriebenen PDF (digitale Unterschrift oder Foto genügt). Bei Fragen melde dich gern vor der Unterschrift.`)}
    ` : ``}
    ${p(`<em style="color:#64748b;">Das Team von Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Du erhältst diese E-Mail, weil dein Lehrerkonto bei Aprender-Aleman.de bestätigt wurde.";

  const text = [
    `Hallo ${v.name}!`,
    ``,
    `Deine Registrierung wurde bestätigt.`,
    ``,
    `Passwort erstellen (${v.validDays} Tage gültig):`,
    v.setPasswordUrl,
    ``,
    `Dein Benutzer: ${v.email}`,
    ``,
    `DEINE ERSTEN SCHRITTE: ${v.onboardingDocUrl}`,
    ``,
    ...(v.agreementAttached ? [`DEINE KOOPERATIONSVEREINBARUNG: im Anhang als PDF. Bitte unterschrieben per Antwort zurücksenden.`, ``] : []),
    `Das Team von Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
