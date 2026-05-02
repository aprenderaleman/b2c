import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * "Bienvenido a la plataforma" — first-login welcome email enviado por
 * un admin desde /admin/usuarios cuando un alumno aún no ha entrado.
 *
 * Combina los 3 elementos que el alumno necesita:
 *   1. URL del login + cuál es su email de cuenta
 *   2. Botón directo para establecer contraseña (token válido 1h)
 *   3. Tour rápido de qué puede hacer dentro
 *
 * Bilingüe (es/de).
 */
export type WelcomePlatformVars = {
  name:           string | null;
  loginEmail:     string;       // email registrado del usuario
  setPasswordUrl: string;       // URL del reset con token (válido N horas)
  expiresInHours: number;
  platformUrl:    string;       // ej. "https://b2c.aprender-aleman.de"
  language:       "es" | "de";
};

export function renderWelcomePlatform(v: WelcomePlatformVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: WelcomePlatformVars): RenderedEmail {
  const subject = "Bienvenido a Aprender-Aleman.de — accede a tu cuenta 🇩🇪";
  const greeting = v.name ? `¡Hola ${escapeHtml(v.name)}!` : "¡Hola!";

  const body = `
    ${h2(greeting)}
    ${p(`Bienvenido a tu plataforma de Aprender-Aleman.de. Tu cuenta ya está lista; solo te falta establecer tu contraseña para entrar.`)}

    <div style="margin:18px 0; padding:14px 16px; border-radius:12px; background:#FFF7ED; border:1px solid #FED7AA;">
      <p style="margin:0; font-size:14px; color:#7C2D12;">
        <strong>📧 Tu email de acceso:</strong> ${escapeHtml(v.loginEmail)}
      </p>
    </div>

    ${p(`Pulsa el botón de abajo para elegir tu contraseña la primera vez:`)}
    <div style="text-align:center; margin:22px 0 24px 0;">
      ${button(v.setPasswordUrl, "Establecer mi contraseña →")}
    </div>
    ${p(`<em style="color:#64748b;">Este enlace caduca en ${v.expiresInHours} hora${v.expiresInHours === 1 ? "" : "s"}. Si se vence, puedes pedir uno nuevo desde <a href="${escapeHtml(v.platformUrl)}/forgot-password">${escapeHtml(v.platformUrl)}/forgot-password</a>.</em>`)}

    ${h2("¿Qué puedes hacer dentro?")}
    ${p(`
      <strong>📅 Mis clases</strong> — Verás tus clases agendadas, podrás entrar al aula online cuando empiece la clase, y revisar tu historial de clases pasadas.<br><br>
      <strong>📚 Materiales</strong> — Descarga PDFs y recursos compartidos por tu profesor/a.<br><br>
      <strong>📝 Tareas</strong> — Tu profesor/a te asignará tareas; aquí las completas y las envías.<br><br>
      <strong>🎓 Certificados</strong> — Descarga los certificados que vayas obteniendo.
    `)}

    ${h2("¿Necesitas ayuda?")}
    ${p(`Si tienes cualquier duda — desde no recordar tu contraseña hasta problemas técnicos con la cámara/micro — responde a este mismo correo y te ayudamos.`)}

    ${p(`¡Bienvenido y a disfrutar el alemán! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— El equipo de Aprender-Aleman.de</em>`)}
  `;

  const footerNote = `Recibes este correo porque tienes una cuenta activa en Aprender-Aleman.de.`;

  const text = [
    greeting,
    ``,
    `Bienvenido a tu plataforma de Aprender-Aleman.de.`,
    `Tu cuenta ya está lista; solo te falta establecer tu contraseña.`,
    ``,
    `📧 Tu email de acceso: ${v.loginEmail}`,
    ``,
    `🔑 Establecer mi contraseña:`,
    `${v.setPasswordUrl}`,
    `(este enlace caduca en ${v.expiresInHours} hora${v.expiresInHours === 1 ? "" : "s"})`,
    ``,
    `Si se vence, pide uno nuevo desde:`,
    `${v.platformUrl}/forgot-password`,
    ``,
    `¿QUÉ PUEDES HACER DENTRO?`,
    `• Mis clases — agendadas + entrar al aula + historial`,
    `• Materiales — PDFs y recursos del profesor`,
    `• Tareas — completar y enviar`,
    `• Certificados — descargar los que vayas obteniendo`,
    ``,
    `¿NECESITAS AYUDA?`,
    `Responde a este correo y te ayudamos.`,
    ``,
    `¡Bienvenido y a disfrutar el alemán!`,
    `— El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: WelcomePlatformVars): RenderedEmail {
  const subject = "Willkommen bei Aprender-Aleman.de — Zugang zu deinem Konto 🇩🇪";
  const greeting = v.name ? `Hallo ${escapeHtml(v.name)}!` : "Hallo!";

  const body = `
    ${h2(greeting)}
    ${p(`Willkommen auf deiner Aprender-Aleman.de-Plattform. Dein Konto ist bereit; du musst nur noch dein Passwort festlegen.`)}

    <div style="margin:18px 0; padding:14px 16px; border-radius:12px; background:#FFF7ED; border:1px solid #FED7AA;">
      <p style="margin:0; font-size:14px; color:#7C2D12;">
        <strong>📧 Deine Login-E-Mail:</strong> ${escapeHtml(v.loginEmail)}
      </p>
    </div>

    ${p(`Klicke auf den Button, um dein Passwort zum ersten Mal zu wählen:`)}
    <div style="text-align:center; margin:22px 0 24px 0;">
      ${button(v.setPasswordUrl, "Passwort festlegen →")}
    </div>
    ${p(`<em style="color:#64748b;">Dieser Link läuft in ${v.expiresInHours} Stunde${v.expiresInHours === 1 ? "" : "n"} ab. Wenn er abläuft, kannst du einen neuen unter <a href="${escapeHtml(v.platformUrl)}/forgot-password">${escapeHtml(v.platformUrl)}/forgot-password</a> anfordern.</em>`)}

    ${h2("Was kannst du auf der Plattform machen?")}
    ${p(`
      <strong>📅 Meine Stunden</strong> — Hier siehst du deine geplanten Stunden, kannst zum Online-Klassenzimmer beitreten und deine vergangenen Stunden einsehen.<br><br>
      <strong>📚 Materialien</strong> — Lade PDFs und Ressourcen herunter, die deine Lehrkraft teilt.<br><br>
      <strong>📝 Aufgaben</strong> — Deine Lehrkraft weist dir Aufgaben zu; hier kannst du sie bearbeiten und einreichen.<br><br>
      <strong>🎓 Zertifikate</strong> — Lade die Zertifikate herunter, die du bekommst.
    `)}

    ${h2("Brauchst du Hilfe?")}
    ${p(`Bei Fragen — vom vergessenen Passwort bis zu technischen Problemen mit Kamera/Mikrofon — antworte einfach auf diese E-Mail.`)}

    ${p(`Willkommen und viel Spaß beim Deutschlernen! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— Dein Aprender-Aleman.de Team</em>`)}
  `;

  const footerNote = `Du erhältst diese E-Mail, weil du ein aktives Konto bei Aprender-Aleman.de hast.`;

  const text = [
    greeting,
    ``,
    `Willkommen auf deiner Aprender-Aleman.de-Plattform.`,
    `Dein Konto ist bereit; du musst nur noch dein Passwort festlegen.`,
    ``,
    `📧 Deine Login-E-Mail: ${v.loginEmail}`,
    ``,
    `🔑 Passwort festlegen:`,
    `${v.setPasswordUrl}`,
    `(dieser Link läuft in ${v.expiresInHours} Stunde${v.expiresInHours === 1 ? "" : "n"} ab)`,
    ``,
    `Wenn er abläuft, fordere einen neuen unter:`,
    `${v.platformUrl}/forgot-password`,
    ``,
    `WAS KANNST DU AUF DER PLATTFORM MACHEN?`,
    `• Meine Stunden — geplant + zum Klassenzimmer + Verlauf`,
    `• Materialien — PDFs und Ressourcen`,
    `• Aufgaben — bearbeiten und einreichen`,
    `• Zertifikate — herunterladen`,
    ``,
    `BRAUCHST DU HILFE?`,
    `Antworte auf diese E-Mail.`,
    ``,
    `Willkommen und viel Spaß beim Deutschlernen!`,
    `— Dein Aprender-Aleman.de Team`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
