import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type WelcomeStudentVars = {
  name: string;
  email: string;
  tempPassword: string;
  platformUrl: string;          // e.g. https://b2c.aprender-aleman.de
  hansUrl: string;              // https://hans.aprender-aleman.de
  schuleUrl: string;            // https://schule.aprender-aleman.de
  subscriptionLabel: string;    // "Paquete de 20 clases" / "Suscripción mensual", rendered already in the caller's language
  subscriptionDetails: string;  // one-line detail, e.g. "20 clases restantes · 400 €"
  language: "es" | "de";
};

export function renderWelcomeStudent(v: WelcomeStudentVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

// ---------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------
function renderES(v: WelcomeStudentVars): RenderedEmail {
  const subject = `¡Bienvenido/a a Aprender-Aleman.de, ${v.name}!`;
  // Mandamos al login directo (no a la home pública).
  const loginUrl = v.platformUrl.replace(/\/$/, "") + "/login";

  const greeting = `¡Bienvenido/a ${v.name}! ☀️`;
  const intro    = "Tu cuenta en nuestra academia está lista. Desde hoy tienes acceso a todo:";

  const primeraSemanaBlock = `
    <div style="margin:24px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Tu primera semana</div>
    <ol style="padding-left:20px;line-height:1.6;">
      <li><strong>Hoy:</strong> entra a la plataforma 5 minutos y familiarízate.</li>
      <li><strong>Mañana:</strong> conoce a Hans, tu tutor de IA — te escribiré con el link.</li>
      <li><strong>Esta semana:</strong> arranca con SCHULE (nuestro gimnasio de ejercicios).</li>
    </ol>
  `;

  const body = `
    ${h2(greeting)}
    ${p(intro)}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Tus accesos</div>
    ${kvBlock([
      ["Plataforma",   `<a href="${loginUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(loginUrl)}</a>`],
      ["Usuario",      escapeHtml(v.email)],
      ["Contraseña",   `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Podrás cambiar la contraseña al entrar por primera vez.</em>`)}

    <div style="text-align:center;margin:24px 0 28px 0;">
      ${button(loginUrl, "Entrar a la plataforma →")}
    </div>

    ${primeraSemanaBlock}

    ${p("Tu <strong>Garantía de Nivel por escrito</strong> va adjunta a este correo.")}
    ${p("¡Bienvenido/a oficialmente! 🇩🇪")}
    ${p(`<em style="color:#64748b;">Gelfis · Aprender-Aleman.de</em>`)}
  `;

  const footerNote = `Recibes este correo porque te has convertido en estudiante de Aprender-Aleman.de.`;
  const html = renderEnvelope(body, footerNote);

  const text = [
    `¡Bienvenido/a ${v.name}! ☀️`,
    ``,
    `Tu cuenta en nuestra academia está lista. Desde hoy tienes acceso a todo:`,
    ``,
    `Plataforma: ${loginUrl}`,
    `Usuario: ${v.email}`,
    `Contraseña temporal: ${v.tempPassword}`,
    `(Podrás cambiarla al entrar)`,
    ``,
    `Entrar a la plataforma → ${loginUrl}`,
    ``,
    `En tu panel podrás ver tus próximas clases, grabaciones, chat con tu profesor y todo lo que necesites.`,
    ``,
    `¡Bienvenido/a oficialmente! 🇩🇪`,
    `El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------
// German
// ---------------------------------------------------------------------
function renderDE(v: WelcomeStudentVars): RenderedEmail {
  const subject = `Willkommen bei Aprender-Aleman.de, ${v.name}!`;
  const loginUrl = v.platformUrl.replace(/\/$/, "") + "/login";

  const greeting = `Willkommen ${v.name}! ☀️`;
  const intro    = "Dein Konto in unserer Akademie ist bereit. Ab heute hast du vollen Zugang:";

  const body = `
    ${h2(greeting)}
    ${p(intro)}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Deine Zugangsdaten</div>
    ${kvBlock([
      ["Plattform",      `<a href="${loginUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(loginUrl)}</a>`],
      ["Benutzername",   escapeHtml(v.email)],
      ["Passwort",       `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Du kannst das Passwort nach dem ersten Login ändern.</em>`)}

    <div style="text-align:center;margin:24px 0 28px 0;">
      ${button(loginUrl, "Zur Plattform →")}
    </div>

    ${p("In deinem Bereich siehst du deine nächsten Stunden, Aufnahmen, den Chat mit deinem Lehrer und alles, was du brauchst.")}
    ${p("Herzlich willkommen! 🇩🇪")}
    ${p(`<em style="color:#64748b;">Dein Aprender-Aleman.de Team</em>`)}
  `;

  const footerNote = `Du erhältst diese E-Mail, weil du zum Schüler bei Aprender-Aleman.de geworden bist.`;
  const html = renderEnvelope(body, footerNote);

  const text = [
    `Willkommen ${v.name}! ☀️`,
    ``,
    `Dein Konto in unserer Akademie ist bereit. Ab heute hast du vollen Zugang:`,
    ``,
    `Plattform: ${loginUrl}`,
    `Benutzername: ${v.email}`,
    `Temporäres Passwort: ${v.tempPassword}`,
    `(Du kannst es nach dem ersten Login ändern)`,
    ``,
    `Zur Plattform → ${loginUrl}`,
    ``,
    `In deinem Bereich siehst du deine nächsten Stunden, Aufnahmen, den Chat mit deinem Lehrer und alles, was du brauchst.`,
    ``,
    `Herzlich willkommen! 🇩🇪`,
    `Dein Aprender-Aleman.de Team`,
  ].join("\n");

  return { subject, html, text };
}
