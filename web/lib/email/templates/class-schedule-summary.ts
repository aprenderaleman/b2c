import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email "resumen de clases agendadas" — Gelfis 2026-06-23.
 *
 * Se envía UNA vez al estudiante cuando el profesor agenda múltiples
 * horarios en bloque desde el modal flexible (/api/teacher/classes/bulk).
 *
 * Contenido:
 *   - Resumen: total de clases agendadas
 *   - Primera clase: fecha exacta
 *   - Horarios humanos (e.g. "Lunes a las 18:00 (semanal hasta 25/08)")
 *   - Instrucciones para unirse el día de la clase
 *   - Botón al panel del estudiante
 */
export type ClassScheduleSummaryVars = {
  recipientName: string;
  classTitle:    string;
  totalClasses:  number;
  firstClassAt:  string;            // pre-formateado en TZ Berlín
  slotsHuman:    string[];          // lista de horarios en lenguaje natural
  classUrl:      string;            // /estudiante/clases/{id}
  language:      "es" | "de";
};

export function renderClassScheduleSummary(v: ClassScheduleSummaryVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: ClassScheduleSummaryVars): RenderedEmail {
  const subject = `🎉 Tus ${v.totalClasses} clases están agendadas — empiezas el ${v.firstClassAt}`;

  const slotsList = v.slotsHuman.map(s => `• ${escapeHtml(s)}`).join("<br>");
  const slotsListPlain = v.slotsHuman.map(s => `• ${s}`).join("\n");

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(`Te confirmamos <strong>${v.totalClasses} clase${v.totalClasses === 1 ? "" : "s"}</strong> agendada${v.totalClasses === 1 ? "" : "s"} para ${escapeHtml(v.classTitle)}.`)}
    ${kvBlock([
      ["📅 Tu primera clase", escapeHtml(v.firstClassAt)],
      ["📊 Total de clases", String(v.totalClasses)],
    ])}
    ${h2(`Tus horarios`)}
    ${p(slotsList)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.classUrl, "Ver mis clases en el panel →")}
    </div>
    ${h2(`Cómo unirte el día de la clase`)}
    ${p(`<strong>5 minutos antes</strong>, entra a tu panel y pulsa <strong>"Entrar al aula"</strong>. No hace falta instalar nada — el aula se abre directamente en el navegador.`)}
    ${p(`Antes de cada clase, asegúrate de tener:`)}
    ${p(`• Buena conexión a internet<br>• Cámara y micrófono funcionando<br>• Un sitio tranquilo durante la clase`)}
    ${p(`Te enviaremos un recordatorio antes de cada clase para que no se te escape ninguna.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;

  const footerNote = "Recibes este correo porque tienes clases agendadas con nosotros.";

  const text = [
    `¡Hola ${v.recipientName}!`, ``,
    `Te confirmamos ${v.totalClasses} clase${v.totalClasses === 1 ? "" : "s"} agendada${v.totalClasses === 1 ? "" : "s"} para ${v.classTitle}.`, ``,
    `📅 Tu primera clase: ${v.firstClassAt}`,
    `📊 Total: ${v.totalClasses} clase${v.totalClasses === 1 ? "" : "s"}`, ``,
    `Tus horarios:`,
    slotsListPlain, ``,
    `Ver mis clases: ${v.classUrl}`, ``,
    `Cómo unirte el día de la clase:`,
    `5 minutos antes, entra a tu panel y pulsa "Entrar al aula".`,
    `No hace falta instalar nada — el aula se abre en el navegador.`,
    `Necesitas: buena conexión, cámara y micrófono, lugar tranquilo.`, ``,
    `Te enviaremos un recordatorio antes de cada clase.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: ClassScheduleSummaryVars): RenderedEmail {
  const subject = `🎉 Deine ${v.totalClasses} Stunden sind agendiert — Start am ${v.firstClassAt}`;

  const slotsList = v.slotsHuman.map(s => `• ${escapeHtml(s)}`).join("<br>");
  const slotsListPlain = v.slotsHuman.map(s => `• ${s}`).join("\n");

  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(`Wir bestätigen <strong>${v.totalClasses} Stunde${v.totalClasses === 1 ? "" : "n"}</strong> für ${escapeHtml(v.classTitle)}.`)}
    ${kvBlock([
      ["📅 Deine erste Stunde", escapeHtml(v.firstClassAt)],
      ["📊 Stunden insgesamt", String(v.totalClasses)],
    ])}
    ${h2(`Deine Termine`)}
    ${p(slotsList)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.classUrl, "Meine Stunden im Bereich →")}
    </div>
    ${h2(`So trittst du am Tag der Stunde bei`)}
    ${p(`<strong>5 Minuten vorher</strong> gehst du in deinen Bereich und klickst auf <strong>„Zum Klassenzimmer"</strong>. Du musst nichts installieren — das Klassenzimmer öffnet sich direkt im Browser.`)}
    ${p(`Vor jeder Stunde stell sicher:`)}
    ${p(`• Stabile Internetverbindung<br>• Funktionierende Kamera und Mikrofon<br>• Ein ruhiger Ort während der Stunde`)}
    ${p(`Vor jeder Stunde bekommst du eine Erinnerung.`)}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;

  const footerNote = "Du erhältst diese E-Mail, weil du Stunden bei uns hast.";

  const text = [
    `Hallo ${v.recipientName}!`, ``,
    `Wir bestätigen ${v.totalClasses} Stunde${v.totalClasses === 1 ? "" : "n"} für ${v.classTitle}.`, ``,
    `📅 Deine erste Stunde: ${v.firstClassAt}`,
    `📊 Insgesamt: ${v.totalClasses} Stunde${v.totalClasses === 1 ? "" : "n"}`, ``,
    `Deine Termine:`,
    slotsListPlain, ``,
    `Meine Stunden: ${v.classUrl}`, ``,
    `So trittst du am Tag der Stunde bei:`,
    `5 Minuten vorher in deinen Bereich gehen und auf "Zum Klassenzimmer" klicken.`,
    `Du musst nichts installieren.`,
    `Brauchst: stabile Verbindung, Kamera und Mikrofon, ruhiger Ort.`, ``,
    `Vor jeder Stunde bekommst du eine Erinnerung.`, ``,
    `— Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
