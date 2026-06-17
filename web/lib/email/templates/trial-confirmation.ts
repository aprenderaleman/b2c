import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";
import type { LeadJoinUrl } from "@/lib/trial-token";

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
  joinUrl:        LeadJoinUrl;     // OBLIGATORIO: construir vía buildLeadJoinUrl()
  language:       "es" | "de";
};

export function renderTrialConfirmation(v: TrialConfirmationVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialConfirmationVars): RenderedEmail {
  const subject = `${v.leadName}, tu clase de prueba está agendada — ${v.startDate}`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! Soy Stiv de la academia Aprender-Aleman.de 👋`)}
    ${p(`Tu <strong>clase de alemán</strong> está agendada para:`)}
    ${kvBlock([
      ["📅 Fecha",     escapeHtml(v.startDate)],
      ["⏱ Duración",   `${v.durationMin} minutos`],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Entrar al aula el día de la clase →")}
    </div>
    ${p(`<em style="color:#64748b;">Este enlace es exclusivo para ti. Guárdalo, lo usarás el día de la clase para entrar directamente sin contraseña.</em>`)}
    <div style="margin:24px 0;padding:16px 18px;border-radius:12px;background:#FFF7ED;border:1px solid #FED7AA;">
      <p style="margin:0 0 10px 0;font-size:14px;color:#9A3412;line-height:1.5;">
        <strong>⚠️ IMPORTANTE: Necesito tu confirmación EXPLÍCITA por WhatsApp.</strong>
      </p>
      <p style="margin:0;font-size:14px;color:#9A3412;line-height:1.6;">
        Respóndeme por WhatsApp con:<br>
        👉 <strong>"CONFIRMO"</strong> si vas a asistir<br>
        👉 <strong>"CAMBIAR"</strong> si necesitas otra fecha<br>
        👉 <strong>"CANCELAR"</strong> si ya no te interesa<br><br>
        Sin tu respuesta en 12h, tu slot se libera para otro estudiante en lista de espera.
      </p>
    </div>
    ${h2(`Cómo prepararte`)}
    ${p(`No necesitas estudiar nada — la clase es 100% conversacional y tu profesor/a se adapta a tu nivel. Solo asegúrate de tener:`)}
    ${p(`• Buena conexión a internet<br>• Cámara y micrófono funcionando<br>• Un sitio tranquilo durante 45 min`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque acabas de agendar una clase de prueba en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}! Soy Stiv de la academia Aprender-Aleman.de.`, ``,
    `Tu clase de alemán está agendada para:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} min`, ``,
    `Entrar al aula el día de la clase: ${v.joinUrl}`,
    `(este enlace es exclusivo para ti — no requiere contraseña)`, ``,
    `⚠️ IMPORTANTE: Necesito tu confirmación EXPLÍCITA por WhatsApp.`,
    `Respóndeme con:`,
    `👉 "CONFIRMO" si vas a asistir`,
    `👉 "CAMBIAR" si necesitas otra fecha`,
    `👉 "CANCELAR" si ya no te interesa`,
    `Sin tu respuesta en 12h, tu slot se libera para otro estudiante en lista de espera.`, ``,
    `Cómo prepararte:`,
    `• La clase es conversacional, no necesitas estudiar nada antes.`,
    `• Asegúrate de tener buena conexión, cámara y micrófono.`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TrialConfirmationVars): RenderedEmail {
  const subject = `${v.leadName}, deine Probestunde ist gebucht — ${v.startDate}`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! Ich bin Stiv von der Akademie Aprender-Aleman.de 👋`)}
    ${p(`Deine <strong>Deutsch-Probestunde</strong> ist gebucht für:`)}
    ${kvBlock([
      ["📅 Datum",     escapeHtml(v.startDate)],
      ["⏱ Dauer",      `${v.durationMin} Minuten`],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.joinUrl, "Zum Klassenzimmer am Tag der Stunde →")}
    </div>
    <div style="margin:24px 0;padding:16px 18px;border-radius:12px;background:#FFF7ED;border:1px solid #FED7AA;">
      <p style="margin:0 0 10px 0;font-size:14px;color:#9A3412;line-height:1.5;">
        <strong>⚠️ WICHTIG: Ich brauche deine ausdrückliche Bestätigung per WhatsApp.</strong>
      </p>
      <p style="margin:0;font-size:14px;color:#9A3412;line-height:1.6;">
        Antworte mir per WhatsApp mit:<br>
        👉 <strong>"CONFIRMO"</strong> wenn du dabei bist<br>
        👉 <strong>"CAMBIAR"</strong> wenn du einen anderen Termin brauchst<br>
        👉 <strong>"CANCELAR"</strong> wenn du nicht mehr interessiert bist<br><br>
        Ohne deine Antwort innerhalb von 12 Stunden wird dein Slot für einen anderen Schüler auf der Warteliste freigegeben.
      </p>
    </div>
    ${p(`<em style="color:#64748b;">Dieser Link ist nur für dich. Speichere ihn — du brauchst ihn am Tag der Stunde, um ohne Passwort einzutreten.</em>`)}
    ${h2(`Wie du dich vorbereitest`)}
    ${p(`Du musst nichts lernen — die Stunde ist konversationsbasiert und deine Lehrer/in passt sich deinem Niveau an. Stell nur Folgendes sicher:`)}
    ${p(`• Stabile Internetverbindung<br>• Funktionierende Kamera und Mikrofon<br>• Ein ruhiger Ort für 45 Minuten`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du gerade eine Probestunde auf Aprender-Aleman.de gebucht hast.";
  const text = [
    `Hallo ${v.leadName}! Ich bin Stiv von der Akademie Aprender-Aleman.de.`, ``,
    `Deine Deutsch-Probestunde ist gebucht für:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} Min`, ``,
    `Zum Klassenzimmer am Tag der Stunde: ${v.joinUrl}`,
    `(dieser Link ist nur für dich — kein Passwort nötig)`, ``,
    `⚠️ WICHTIG: Ich brauche deine ausdrückliche Bestätigung per WhatsApp.`,
    `Antworte mit:`,
    `👉 "CONFIRMO" wenn du dabei bist`,
    `👉 "CAMBIAR" wenn du einen anderen Termin brauchst`,
    `👉 "CANCELAR" wenn du nicht mehr interessiert bist`,
    `Ohne deine Antwort innerhalb von 12 Stunden wird dein Slot freigegeben.`, ``,
    `Vorbereitung:`,
    `• Konversationsbasierte Stunde — nichts zu lernen vorher.`,
    `• Stabile Internetverbindung, Kamera und Mikrofon.`, ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
