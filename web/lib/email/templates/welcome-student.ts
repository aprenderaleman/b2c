import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type WelcomeStudentVars = {
  name: string;
  email: string;
  tempPassword: string;
  platformUrl: string;          // e.g. https://live.aprender-aleman.de
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
  const subject = `¡Bienvenido a Aprender-Aleman.de, ${v.name}!`;

  const greeting = `¡Hola ${v.name}!`;
  const intro    = "Tu cuenta en nuestra academia está lista. Desde hoy tienes acceso a todo:";

  const body = `
    ${h2(greeting)}
    ${p(intro)}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Tus accesos</div>
    ${kvBlock([
      ["Plataforma",   `<a href="${v.platformUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.platformUrl)}</a>`],
      ["Usuario",      escapeHtml(v.email)],
      ["Contraseña",   `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Podrás cambiar la contraseña al entrar por primera vez.</em>`)}

    <div style="text-align:center;margin:24px 0 28px 0;">
      ${button(v.platformUrl, "Entrar a la plataforma →")}
    </div>

    <div style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Tu plan</div>
    ${kvBlock([
      ["Tipo",     escapeHtml(v.subscriptionLabel)],
      ["Detalles", escapeHtml(v.subscriptionDetails)],
    ])}

    <div style="margin:22px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">También tienes acceso a</div>
    ${p(`<strong>🎓 SCHULE</strong> — Aula virtual con ejercicios, audios, gramática y vocabulario.<br><a href="${v.schuleUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.schuleUrl)}</a>`)}
    ${p(`<strong>🤖 HANS</strong> — Tu profesor de IA 24/7. Practica conversación por voz o texto cuando quieras.<br><a href="${v.hansUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.hansUrl)}</a>`)}

    ${p("En tu panel podrás ver tus próximas clases, grabaciones, chat con tu profesor y todo lo que necesites.")}
    ${p("¡Bienvenido oficialmente! 🇩🇪")}
    ${p(`<em style="color:#64748b;">El equipo de Aprender-Aleman.de</em>`)}
  `;

  const footerNote = `Recibes este correo porque te has convertido en estudiante de Aprender-Aleman.de.`;
  const html = renderEnvelope(body, footerNote);

  const text = [
    `¡Hola ${v.name}!`,
    ``,
    `Tu cuenta en nuestra academia está lista. Desde hoy tienes acceso a todo:`,
    ``,
    `Plataforma: ${v.platformUrl}`,
    `Usuario: ${v.email}`,
    `Contraseña temporal: ${v.tempPassword}`,
    `(Podrás cambiarla al entrar)`,
    ``,
    `Tu plan:`,
    `- Tipo: ${v.subscriptionLabel}`,
    `- ${v.subscriptionDetails}`,
    ``,
    `También tienes acceso a:`,
    `- SCHULE (Aula Virtual): ${v.schuleUrl}`,
    `- HANS (Tu profesor IA 24/7): ${v.hansUrl}`,
    ``,
    `¡Bienvenido oficialmente! 🇩🇪`,
    `El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------
// German
// ---------------------------------------------------------------------
function renderDE(v: WelcomeStudentVars): RenderedEmail {
  const subject = `Willkommen bei Aprender-Aleman.de, ${v.name}!`;

  const greeting = `Hallo ${v.name}!`;
  const intro    = "Dein Konto in unserer Akademie ist bereit. Ab heute hast du vollen Zugang:";

  const body = `
    ${h2(greeting)}
    ${p(intro)}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Deine Zugangsdaten</div>
    ${kvBlock([
      ["Plattform",      `<a href="${v.platformUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.platformUrl)}</a>`],
      ["Benutzername",   escapeHtml(v.email)],
      ["Passwort",       `<code style="background:#fff7ed;padding:2px 8px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(v.tempPassword)}</code>`],
    ])}
    ${p(`<em style="color:#64748b;">Du kannst das Passwort nach dem ersten Login ändern.</em>`)}

    <div style="text-align:center;margin:24px 0 28px 0;">
      ${button(v.platformUrl, "Zur Plattform →")}
    </div>

    <div style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Dein Plan</div>
    ${kvBlock([
      ["Typ",      escapeHtml(v.subscriptionLabel)],
      ["Details",  escapeHtml(v.subscriptionDetails)],
    ])}

    <div style="margin:22px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Du hast außerdem Zugang zu</div>
    ${p(`<strong>🎓 SCHULE</strong> — Virtuelles Klassenzimmer mit Übungen, Audios, Grammatik und Wortschatz.<br><a href="${v.schuleUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.schuleUrl)}</a>`)}
    ${p(`<strong>🤖 HANS</strong> — Dein KI-Lehrer 24/7. Übe Gespräche per Sprache oder Text, wann immer du willst.<br><a href="${v.hansUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.hansUrl)}</a>`)}

    ${p("In deinem Bereich siehst du deine nächsten Stunden, Aufnahmen, den Chat mit deinem Lehrer und alles, was du brauchst.")}
    ${p("Herzlich willkommen! 🇩🇪")}
    ${p(`<em style="color:#64748b;">Dein Aprender-Aleman.de Team</em>`)}
  `;

  const footerNote = `Du erhältst diese E-Mail, weil du zum Schüler bei Aprender-Aleman.de geworden bist.`;
  const html = renderEnvelope(body, footerNote);

  const text = [
    `Hallo ${v.name}!`,
    ``,
    `Dein Konto in unserer Akademie ist bereit. Ab heute hast du vollen Zugang:`,
    ``,
    `Plattform: ${v.platformUrl}`,
    `Benutzername: ${v.email}`,
    `Temporäres Passwort: ${v.tempPassword}`,
    `(Du kannst es nach dem ersten Login ändern)`,
    ``,
    `Dein Plan:`,
    `- Typ: ${v.subscriptionLabel}`,
    `- ${v.subscriptionDetails}`,
    ``,
    `Du hast außerdem Zugang zu:`,
    `- SCHULE (Virtuelles Klassenzimmer): ${v.schuleUrl}`,
    `- HANS (Dein KI-Lehrer 24/7): ${v.hansUrl}`,
    ``,
    `Herzlich willkommen! 🇩🇪`,
    `Dein Aprender-Aleman.de Team`,
  ].join("\n");

  return { subject, html, text };
}
