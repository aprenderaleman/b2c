import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Confirmation email sent the second a lead books their trial class
 * from the public funnel. Includes the magic-link URL to enter the
 * aula at class time, plus an .ics-friendly summary of the slot.
 */
export type TrialConfirmationVars = {
  leadName:       string;          // first name
  classTitle:     string;          // "Clase de prueba con Sabine"
  startDate:      string;          // pre-formatted "viernes 26 de abril, 17:00 (Berlín)"
  durationMin:    number;          // 45
  teacherName:    string;
  joinUrl:        string;          // https://b2c.aprender-aleman.de/trial/{classId}?t={token}
  language:       "es" | "de";
};

export function renderTrialConfirmation(v: TrialConfirmationVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialConfirmationVars): RenderedEmail {
  const subject = `✅ Tu clase de prueba de alemán está agendada — ${v.startDate}`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Tu <strong>clase de prueba gratuita de alemán</strong> está confirmada. Apúntala en tu calendario y nos vemos en el aula online.`)}
    ${kvBlock([
      ["📅 Fecha",     escapeHtml(v.startDate)],
      ["⏱ Duración",   `${v.durationMin} minutos`],
      ["👤 Con",       escapeHtml(v.teacherName)],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Entrar al aula →")}
    </div>
    ${p(`<em style="color:#64748b;">Este enlace es exclusivo para ti. Guárdalo, lo usarás el día de la clase para entrar directamente sin contraseña.</em>`)}
    <div style="margin:18px 0 4px 0;padding:14px 16px;border-radius:12px;background:#FFF7ED;border:1px solid #FED7AA;">
      <p style="margin:0;font-size:14px;color:#7C2D12;line-height:1.5;">
        <strong>⚠️ Importante:</strong> al pulsar el botón, tu navegador pedirá permiso para usar el <strong>micrófono y la cámara</strong>. Pulsa <strong>"Permitir"</strong> — sin eso el profesor no podrá oírte ni verte.
      </p>
    </div>
    ${h2(`Cómo prepararte`)}
    ${p(`No necesitas estudiar nada — la clase es 100% conversacional y tu profesor/a se adapta a tu nivel. Solo asegúrate de tener:`)}
    ${p(`• Buena conexión a internet<br>• Cámara y micrófono funcionando<br>• Un sitio tranquilo durante 45 min`)}
    ${h2(`Recordatorios`)}
    ${p(`Te enviaremos recordatorios por email <strong>24 horas antes</strong> y la <strong>mañana del día</strong> de la clase. 30 minutos antes recibirás un aviso por WhatsApp${" "}(si nos diste tu número).`)}
    ${p(`Si necesitas cancelar o reagendar, responde a este correo.`)}
    ${p(`¡Hasta pronto!`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque acabas de agendar una clase de prueba en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Tu clase de prueba gratuita de alemán está confirmada.`,
    `Fecha: ${v.startDate}`,
    `Duración: ${v.durationMin} min`,
    `Con: ${v.teacherName}`, ``,
    `Entrar al aula: ${v.joinUrl}`,
    `(este enlace es exclusivo para ti — no requiere contraseña)`, ``,
    `⚠️ IMPORTANTE: al abrir el enlace, tu navegador te pedirá permiso para usar`,
    `micrófono y cámara. Pulsa "Permitir" — sin eso el profesor no podrá oírte ni verte.`, ``,
    `Cómo prepararte:`,
    `• La clase es conversacional, no necesitas estudiar nada antes.`,
    `• Asegúrate de tener buena conexión, cámara y micrófono.`, ``,
    `Recordatorios:`,
    `• Email 24 horas antes`,
    `• Email la mañana del día de la clase`,
    `• WhatsApp 30 minutos antes (si nos diste tu número)`, ``,
    `Si necesitas cancelar, responde a este correo.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TrialConfirmationVars): RenderedEmail {
  const subject = `✅ Deine kostenlose Deutsch-Probestunde ist gebucht — ${v.startDate}`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Deine <strong>kostenlose Probestunde Deutsch</strong> ist bestätigt. Trag sie in deinen Kalender ein und wir sehen uns im Online-Klassenzimmer.`)}
    ${kvBlock([
      ["📅 Datum",     escapeHtml(v.startDate)],
      ["⏱ Dauer",      `${v.durationMin} Minuten`],
      ["👤 Mit",       escapeHtml(v.teacherName)],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Zum Klassenzimmer →")}
    </div>
    ${p(`<em style="color:#64748b;">Dieser Link ist nur für dich. Speichere ihn — du brauchst ihn am Tag der Stunde, um ohne Passwort einzutreten.</em>`)}
    <div style="margin:18px 0 4px 0;padding:14px 16px;border-radius:12px;background:#FFF7ED;border:1px solid #FED7AA;">
      <p style="margin:0;font-size:14px;color:#7C2D12;line-height:1.5;">
        <strong>⚠️ Wichtig:</strong> Beim Klick fragt dein Browser nach <strong>Mikrofon- und Kamerazugriff</strong>. Bitte auf <strong>"Erlauben"</strong> klicken — sonst kann dich die Lehrkraft nicht hören oder sehen.
      </p>
    </div>
    ${h2(`Wie du dich vorbereitest`)}
    ${p(`Du musst nichts lernen — die Stunde ist konversationsbasiert und deine Lehrer/in passt sich deinem Niveau an. Stell nur Folgendes sicher:`)}
    ${p(`• Stabile Internetverbindung<br>• Funktionierende Kamera und Mikrofon<br>• Ein ruhiger Ort für 45 Minuten`)}
    ${h2(`Erinnerungen`)}
    ${p(`Wir schicken dir Erinnerungs-E-Mails <strong>24 Stunden vorher</strong> und am <strong>Morgen des Klassentags</strong>. 30 Minuten vorher erhältst du eine WhatsApp${" "}(falls du uns deine Nummer gegeben hast).`)}
    ${p(`Wenn du absagen oder verschieben musst, antworte einfach auf diese E-Mail.`)}
    ${p(`Bis bald!`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du gerade eine Probestunde auf Aprender-Aleman.de gebucht hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Deine kostenlose Probestunde Deutsch ist bestätigt.`,
    `Datum: ${v.startDate}`,
    `Dauer: ${v.durationMin} Min`,
    `Mit: ${v.teacherName}`, ``,
    `Zum Klassenzimmer: ${v.joinUrl}`,
    `(dieser Link ist nur für dich — kein Passwort nötig)`, ``,
    `⚠️ WICHTIG: Beim Öffnen des Links fragt dein Browser nach Mikrofon- und`,
    `Kamerazugriff. Klick auf "Erlauben" — sonst kann dich die Lehrkraft nicht hören oder sehen.`, ``,
    `Vorbereitung:`,
    `• Konversationsbasierte Stunde — nichts zu lernen vorher.`,
    `• Stabile Internetverbindung, Kamera und Mikrofon.`, ``,
    `Erinnerungen:`,
    `• E-Mail 24 Stunden vorher`,
    `• E-Mail am Morgen des Klassentags`,
    `• WhatsApp 30 Minuten vorher (falls du uns deine Nummer gegeben hast)`, ``,
    `Wenn du absagen musst, antworte einfach auf diese E-Mail.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
