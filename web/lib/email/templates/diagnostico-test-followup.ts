import { escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email msg 4 del drip de followups (T+3d) — 24h después de invitar al
 * test de nivel. Pregunta si descubrió su nivel y pide una hora para
 * una breve llamada hoy o mañana.
 *
 * Se manda en paralelo al WhatsApp del mismo msg para maximizar la
 * probabilidad de respuesta.
 */
export type DiagnosticoTestFollowupVars = {
  leadName: string;
  language: "es" | "de";
  testUrl:  string;   // https://schule.aprender-aleman.de/test-de-nivel
  bookUrl:  string;   // fallback "reservar llamada" link
};

export function renderDiagnosticoTestFollowup(v: DiagnosticoTestFollowupVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: DiagnosticoTestFollowupVars): RenderedEmail {
  const subject = `${v.leadName}, ¿descubriste tu nivel de alemán?`;
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Ayer te compartí el <strong>test de nivel gratis</strong> para que veas exactamente en qué punto estás con tu alemán. ¿Pudiste hacerlo?`)}
    ${p(`Si todavía no, te dejo el enlace de nuevo (toma 5 minutos):`)}
    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeHtml(v.testUrl)}"
         style="display:inline-block;background:#0F2847;color:#ffffff;font-weight:bold;
                padding:11px 24px;border-radius:10px;text-decoration:none;font-size:15px;">
        Hacer el test de nivel →
      </a>
    </div>
    ${p(`Y si <strong>ya tienes tu resultado</strong>, me encantaría hablar contigo 15 minutos para explicarte qué camino te conviene desde ahí. <strong>¿A qué hora te vendría bien hoy o mañana?</strong> Respóndeme por WhatsApp o reserva directo:`)}
    <div style="text-align:center;margin:20px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        Reservar llamada de 15 min →
      </a>
    </div>
    ${p(`Bis bald! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Recibes este correo porque hace unos días creaste tu plan en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.leadName}!`, ``,
    `Ayer te compartí el test de nivel gratis para que veas en qué punto estás con tu alemán. ¿Pudiste hacerlo?`, ``,
    `Si todavía no (toma 5 minutos):`,
    `${v.testUrl}`, ``,
    `Y si ya tienes tu resultado, me encantaría hablar contigo 15 minutos para explicarte qué camino te conviene desde ahí.`,
    `¿A qué hora te vendría bien hoy o mañana? Respóndeme por WhatsApp o reserva directo:`,
    `${v.bookUrl}`, ``,
    `Bis bald! 🇩🇪`,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: DiagnosticoTestFollowupVars): RenderedEmail {
  const subject = `${v.leadName}, hast du dein Deutsch-Niveau herausgefunden?`;
  const body = `
    ${h2(`Hallo ${escapeHtml(v.leadName)}! 👋`)}
    ${p(`Gestern habe ich dir den <strong>kostenlosen Niveau-Test</strong> geschickt, damit du genau siehst, wo du mit deinem Deutsch stehst. Hast du es geschafft?`)}
    ${p(`Falls noch nicht, hier ist der Link nochmal (5 Minuten):`)}
    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeHtml(v.testUrl)}"
         style="display:inline-block;background:#0F2847;color:#ffffff;font-weight:bold;
                padding:11px 24px;border-radius:10px;text-decoration:none;font-size:15px;">
        Niveau-Test machen →
      </a>
    </div>
    ${p(`Und falls du <strong>schon dein Ergebnis</strong> hast, würde ich gern 15 Minuten mit dir sprechen, um dir zu erklären, welcher Weg von dort am besten passt. <strong>Wann passt es dir heute oder morgen?</strong> Antworte per WhatsApp oder buche direkt:`)}
    <div style="text-align:center;margin:20px 0 8px 0;">
      <a href="${escapeHtml(v.bookUrl)}"
         style="display:inline-block;background:#F4A261;color:#0F2847;font-weight:bold;
                padding:12px 28px;border-radius:12px;text-decoration:none;font-size:16px;">
        15-Min-Gespräch buchen →
      </a>
    </div>
    ${p(`Bis bald! 🇩🇪`)}
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Du erhältst diese Mail, weil du vor einigen Tagen deinen Plan auf Aprender-Aleman.de erstellt hast.";
  const text = [
    `Hallo ${v.leadName}!`, ``,
    `Gestern habe ich dir den kostenlosen Niveau-Test geschickt. Hast du es geschafft?`, ``,
    `Falls noch nicht (5 Minuten):`,
    `${v.testUrl}`, ``,
    `Und falls du schon dein Ergebnis hast, würde ich gern 15 Minuten mit dir sprechen.`,
    `Wann passt es dir heute oder morgen? Antworte per WhatsApp oder buche direkt:`,
    `${v.bookUrl}`, ``,
    `Bis bald! 🇩🇪`,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
