import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type WelcomeStaffVars = {
  name:         string;
  email:        string;
  tempPassword: string;
  platformUrl:  string;
  role:         "admin" | "teacher" | "closer" | "setter";
  language:     "es" | "de";
};

export function renderWelcomeStaff(v: WelcomeStaffVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: WelcomeStaffVars): RenderedEmail {
  const roleLabel = v.role === "teacher" ? "profesor" : v.role === "closer" ? "closer" : v.role === "setter" ? "setter" : "administrador";
  const subject = `Tu acceso a Aprender-Aleman.de (${roleLabel})`;
  // El destinatario aún no tiene sesión — el botón debe llevar a la
  // pantalla de login (no a "/"), donde podrá usar el email + pwd
  // temporal de abajo. Decisión Gelfis 2026-05-12.
  const loginUrl = `${v.platformUrl.replace(/\/$/, "")}/login`;

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}!`)}
    ${p(`Te acabamos de crear una cuenta como <strong>${roleLabel}</strong> en Aprender-Aleman.de. Estos son tus accesos:`)}
    ${kvBlock([
      ["Plataforma",  `<a href="${loginUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(loginUrl)}</a>`],
      ["Usuario",     escapeHtml(v.email)],
      ["Contraseña",  `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Se te pedirá que cambies la contraseña al entrar por primera vez.</em>`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(loginUrl, "Entrar a la plataforma →")}
    </div>
    ${p(`Bienvenido al equipo. Cualquier duda, respóndenos este correo.`)}
    ${p(`<em style="color:#64748b;">El equipo de Aprender-Aleman.de</em>`)}
  `;
  const footerNote = `Recibes este correo porque te han creado una cuenta de ${roleLabel} en Aprender-Aleman.de.`;

  const text = [
    `Hola ${v.name}!`,
    ``,
    `Te acabamos de crear una cuenta como ${roleLabel} en Aprender-Aleman.de.`,
    ``,
    `Iniciar sesión: ${loginUrl}`,
    `Usuario: ${v.email}`,
    `Contraseña temporal: ${v.tempPassword}`,
    `(Se te pedirá cambiarla al entrar)`,
    ``,
    `Bienvenido al equipo.`,
    `El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: WelcomeStaffVars): RenderedEmail {
  const roleLabel = v.role === "teacher" ? "Lehrer" : v.role === "closer" ? "Closer" : v.role === "setter" ? "Setter" : "Administrator";
  const subject = `Dein Zugang zu Aprender-Aleman.de (${roleLabel})`;
  const loginUrl = `${v.platformUrl.replace(/\/$/, "")}/login`;

  const body = `
    ${h2(`Hallo ${escapeHtml(v.name)}!`)}
    ${p(`Wir haben gerade ein Konto als <strong>${roleLabel}</strong> bei Aprender-Aleman.de für dich angelegt. Deine Zugangsdaten:`)}
    ${kvBlock([
      ["Plattform",     `<a href="${loginUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(loginUrl)}</a>`],
      ["Benutzername",  escapeHtml(v.email)],
      ["Passwort",      `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Beim ersten Login wirst du gebeten, das Passwort zu ändern.</em>`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(loginUrl, "Zur Plattform →")}
    </div>
    ${p(`Willkommen im Team. Bei Fragen antworte einfach auf diese E-Mail.`)}
    ${p(`<em style="color:#64748b;">Dein Aprender-Aleman.de Team</em>`)}
  `;
  const footerNote = `Du erhältst diese E-Mail, weil dir ein ${roleLabel}-Konto auf Aprender-Aleman.de angelegt wurde.`;

  const text = [
    `Hallo ${v.name}!`,
    ``,
    `Wir haben gerade ein Konto als ${roleLabel} bei Aprender-Aleman.de für dich angelegt.`,
    ``,
    `Login: ${loginUrl}`,
    `Benutzername: ${v.email}`,
    `Temporäres Passwort: ${v.tempPassword}`,
    `(Du wirst beim ersten Login gebeten, es zu ändern)`,
    ``,
    `Willkommen im Team.`,
    `Dein Aprender-Aleman.de Team`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
