import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type TeacherWelcomeSetPasswordVars = {
  name:        string;
  email:       string;
  /** Enlace de creación de contraseña (token de un solo uso). */
  setPasswordUrl: string;
  /** Días de validez del enlace, para el copy. */
  validDays:   number;
  language:    "es" | "de";
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
    `Das Team von Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
