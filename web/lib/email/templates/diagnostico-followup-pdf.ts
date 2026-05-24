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
  const subject = `🎁 ${v.leadName}, tu guía gratis de alemán (${v.level}) está aquí`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Soy Stiv otra vez. Como aún no pudimos hablar, te dejo un <strong>regalo</strong>:`)}
    ${p(`📄 <strong>${escapeHtml(v.pdfTitle)}</strong> — una guía de 5 páginas con lo más útil para tu nivel <strong>${escapeHtml(v.level)}</strong>. Sin teoría aburrida. Frases reales, gramática esencial y un mini-diálogo divertido.`)}
    ${p(`<em style="color:#64748b;">📎 La guía va <strong>adjunta</strong> a este correo.</em>`)}
    ${p(`Si después de leerla te animas a una llamada de 15 min para que veamos juntos cómo avanzar más rápido, escríbeme por WhatsApp o reserva aquí:`)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        Reservar una llamada de 15 min →
      </a>
    </div>
    ${p(`<em style="color:#64748b;">Sin presión. Solo cuando estés listo.</em>`)}
    ${p(`Bis bald! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque hace 24h creaste tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Soy Stiv otra vez. Como aún no pudimos hablar, te dejo un regalo:`, ``,
    `📄 ${v.pdfTitle} — una guía de 5 páginas con lo más útil para tu nivel ${v.level}.`,
    `Sin teoría aburrida. Frases reales, gramática esencial y un mini-diálogo divertido.`, ``,
    `La guía va ADJUNTA a este correo.`, ``,
    `Si después de leerla te animas a una llamada de 15 min para que veamos juntos cómo avanzar más rápido, escríbeme por WhatsApp o reserva aquí:`, ``,
    `${v.bookUrl}`, ``,
    `Sin presión. Solo cuando estés listo.`, ``,
    `Bis bald! 🇩🇪`,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: DiagnosticoFollowupPdfVars): RenderedEmail {
  const subject = `🎁 ${v.leadName}, dein gratis Deutsch-Guide (${v.level}) ist da`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Stiv nochmal hier. Da wir uns noch nicht gesprochen haben, schenke ich dir etwas:`)}
    ${p(`📄 <strong>${escapeHtml(v.pdfTitle)}</strong> — ein 5-Seiten-Guide mit dem Wichtigsten für dein Niveau <strong>${escapeHtml(v.level)}</strong>. Keine trockene Theorie. Echte Sätze, essenzielle Grammatik, ein lustiger Mini-Dialog.`)}
    ${p(`<em style="color:#64748b;">📎 Der Guide ist diesem Mail <strong>angehängt</strong>.</em>`)}
    ${p(`Wenn du danach Lust auf ein 15-Minuten-Gespräch hast, antworte per WhatsApp oder buche hier:`)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        15-Min-Gespräch buchen →
      </a>
    </div>
    ${p(`<em style="color:#64748b;">Kein Druck. Nur wenn du bereit bist.</em>`)}
    ${p(`Bis bald! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Du erhältst diese Mail, weil du vor 24h deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Stiv nochmal hier. Da wir uns noch nicht gesprochen haben, schenke ich dir etwas:`, ``,
    `📄 ${v.pdfTitle} — ein 5-Seiten-Guide für dein Niveau ${v.level}.`, ``,
    `Der Guide ist diesem Mail angehängt.`, ``,
    `Wenn du danach Lust auf ein Gespräch hast: ${v.bookUrl}`, ``,
    `Bis bald! 🇩🇪`,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
