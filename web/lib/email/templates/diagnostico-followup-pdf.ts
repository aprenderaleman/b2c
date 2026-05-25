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
    <div style="text-align:center;margin:24px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        Reservar llamada de 15 min →
      </a>
    </div>
    ${p(`<em style="color:#64748b;">Sin presión. Solo cuando estés listo/a.</em>`)}
    ${p(`<strong>Gelfis | Aprender-Aleman.de</strong>`)}
  `;
  const footerNote =
    "Recibes este correo porque creaste tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Sé que estás interesado/a en aprender alemán, así que te he preparado algo: un PDF gratuito con ejercicios adaptados a tu nivel ${v.level} para que empieces a practicar desde hoy.`, ``,
    `Lo encuentras ADJUNTO a este mensaje.`, ``,
    `¡Espero que te sea útil! 💪`, ``,
    `Si quieres, podemos hablar 15 min para diseñarte un plan a medida: ${v.bookUrl}`, ``,
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
    <div style="text-align:center;margin:24px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        15-Min-Gespräch buchen →
      </a>
    </div>
    ${p(`<em style="color:#64748b;">Kein Druck. Nur wenn du bereit bist.</em>`)}
    ${p(`<strong>Gelfis | Aprender-Aleman.de</strong>`)}
  `;
  const footerNote = "Du erhältst diese Mail, weil du deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Ich weiß, du interessierst dich für Deutsch — deshalb habe ich dir etwas vorbereitet: ein kostenloses PDF mit Übungen für dein Niveau ${v.level}, damit du heute mit dem Üben anfangen kannst.`, ``,
    `Du findest es als Anhang in dieser Nachricht.`, ``,
    `Ich hoffe, es hilft dir! 💪`, ``,
    `Lust auf 15 Min Gespräch? ${v.bookUrl}`, ``,
    `Gelfis | Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
