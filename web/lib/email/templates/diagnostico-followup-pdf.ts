import { escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email msg 2 del drip de followups (T+24h) — regala una guía PDF
 * adaptada al nivel del lead. El PDF va ADJUNTO (no en URL externa)
 * para que llegue garantizado, sin clics.
 *
 * El sendDiagnosticoFollowupPdfEmail (en lib/email/send.ts) adjunta
 * el Buffer del PDF descargado previamente del R2.
 */
export type DiagnosticoFollowupPdfVars = {
  leadName: string;
  level:    string;     // "A0", "A1.1"... (display label)
  pdfTitle: string;     // "Tus primeros pasos en alemán"
  language: "es" | "de";
  bookUrl:  string;
};

export function renderDiagnosticoFollowupPdf(v: DiagnosticoFollowupPdfVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoFollowupPdfVars): RenderedEmail {
  const subject = `${v.leadName}, tu PDF gratuito de alemán (${v.level}) 🎁`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}!`)}
    ${p(`Sé que estás interesado/a en aprender alemán, así que te he preparado algo: un <strong>PDF gratuito con ejercicios adaptados a tu nivel ${escapeHtml(v.level)}</strong> para que empieces a practicar desde hoy.`)}
    ${p(`📎 Lo encuentras <strong>adjunto a este mensaje</strong>.`)}
    ${p(`¡Espero que te sea útil! 💪`)}
    ${p(`<strong>Gelfis | Aprender-Aleman.de</strong>`)}
  `;
  // bookUrl ya no se renderiza en el cuerpo — Gelfis pidió quitar el
  // botón CTA del email para que llegue más limpio (el lead que quiera
  // hablar siempre puede responder al email).
  void v.bookUrl;
  const footerNote =
    "Recibes este correo porque creaste tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Sé que estás interesado/a en aprender alemán, así que te he preparado algo: un PDF gratuito con ejercicios adaptados a tu nivel ${v.level} para que empieces a practicar desde hoy.`, ``,
    `Lo encuentras ADJUNTO a este mensaje.`, ``,
    `¡Espero que te sea útil! 💪`, ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: DiagnosticoFollowupPdfVars): RenderedEmail {
  const subject = `${v.leadName}, dein gratis Deutsch-PDF (${v.level}) 🎁`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}!`)}
    ${p(`Ich weiß, du interessierst dich für Deutsch — deshalb habe ich dir etwas vorbereitet: ein <strong>kostenloses PDF mit Übungen für dein Niveau ${escapeHtml(v.level)}</strong>, damit du heute mit dem Üben anfangen kannst.`)}
    ${p(`📎 Du findest es <strong>als Anhang in dieser Nachricht</strong>.`)}
    ${p(`Ich hoffe, es hilft dir! 💪`)}
    ${p(`<strong>Gelfis | Aprender-Aleman.de</strong>`)}
  `;
  void v.bookUrl;
  const footerNote = "Du erhältst diese Mail, weil du deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Ich weiß, du interessierst dich für Deutsch — deshalb habe ich dir etwas vorbereitet: ein kostenloses PDF mit Übungen für dein Niveau ${v.level}, damit du heute mit dem Üben anfangen kannst.`, ``,
    `Du findest es als Anhang in dieser Nachricht.`, ``,
    `Ich hoffe, es hilft dir! 💪`, ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
