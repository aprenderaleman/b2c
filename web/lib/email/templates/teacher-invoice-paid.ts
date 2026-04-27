import { escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * "Te hemos pagado X €" email sent to a teacher when the admin marks
 * their monthly earnings row as paid on /admin/finanzas/profesores.
 * The PDF invoice is attached at the send-wrapper level (see
 * sendTeacherInvoicePaidEmail in lib/email/send.ts).
 *
 * Bilingual — picks Spanish or German based on the teacher's
 * language_preference. Subject line carries the amount + month so it
 * survives a one-line preview in any inbox.
 */
export type TeacherInvoicePaidVars = {
  recipientName:    string;        // Teacher's first name (or full name)
  monthLabel:       string;        // e.g. "abril 2026"
  amount:           string;        // already formatted, e.g. "1.250,00 €"
  classesCount:     number;
  totalHours:       number;        // billed hours
  paymentReference: string | null; // bank txn id / memo, optional
  paymentMethod:    string | null; // teacher's stored payment method
  language:         "es" | "de";
};

export function renderTeacherInvoicePaid(v: TeacherInvoicePaidVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TeacherInvoicePaidVars): RenderedEmail {
  const subject = `Pago realizado: ${v.amount} (${v.monthLabel})`;

  const kv: Array<[string, string]> = [
    ["Periodo",        escapeHtml(v.monthLabel)],
    ["Importe",        `<strong>${escapeHtml(v.amount)}</strong>`],
    ["Clases",         `${v.classesCount}`],
    ["Horas facturadas", v.totalHours.toFixed(1) + " h"],
  ];
  if (v.paymentMethod)    kv.push(["Método de pago",  escapeHtml(v.paymentMethod)]);
  if (v.paymentReference) kv.push(["Referencia",      escapeHtml(v.paymentReference)]);

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.recipientName)}!`)}
    ${p(`Hemos procesado tu pago correspondiente a <strong>${escapeHtml(v.monthLabel)}</strong>. Encontrarás la factura completa adjunta a este correo en formato PDF.`)}
    ${kvBlock(kv)}
    ${p(`Si ves alguna discrepancia con las clases facturadas o el importe, respóndenos a este mismo correo y lo revisamos.`)}
    ${p(`Gracias por tu trabajo este mes.`)}
    ${p(`<em style="color:#64748b;">El equipo de Aprender-Aleman.de</em>`)}
  `;
  const footerNote = `Recibes este correo porque marcamos como pagada tu nómina en la plataforma de Aprender-Aleman.de.`;

  const text = [
    `Hola ${v.recipientName}!`,
    ``,
    `Hemos procesado tu pago correspondiente a ${v.monthLabel}.`,
    ``,
    `Periodo: ${v.monthLabel}`,
    `Importe: ${v.amount}`,
    `Clases: ${v.classesCount}`,
    `Horas facturadas: ${v.totalHours.toFixed(1)} h`,
    v.paymentMethod    ? `Método de pago: ${v.paymentMethod}`       : "",
    v.paymentReference ? `Referencia: ${v.paymentReference}`        : "",
    ``,
    `Encontrarás la factura completa adjunta en formato PDF.`,
    ``,
    `Gracias por tu trabajo este mes.`,
    `El equipo de Aprender-Aleman.de`,
  ].filter(Boolean).join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TeacherInvoicePaidVars): RenderedEmail {
  const subject = `Zahlung erfolgt: ${v.amount} (${v.monthLabel})`;

  const kv: Array<[string, string]> = [
    ["Zeitraum",        escapeHtml(v.monthLabel)],
    ["Betrag",          `<strong>${escapeHtml(v.amount)}</strong>`],
    ["Stunden",         v.totalHours.toFixed(1) + " h"],
    ["Unterrichtseinheiten", `${v.classesCount}`],
  ];
  if (v.paymentMethod)    kv.push(["Zahlungsmethode", escapeHtml(v.paymentMethod)]);
  if (v.paymentReference) kv.push(["Referenz",        escapeHtml(v.paymentReference)]);

  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}!`)}
    ${p(`Wir haben deine Zahlung für <strong>${escapeHtml(v.monthLabel)}</strong> bearbeitet. Die vollständige Rechnung findest du als PDF im Anhang dieser E-Mail.`)}
    ${kvBlock(kv)}
    ${p(`Falls du Unstimmigkeiten bei den abgerechneten Stunden oder dem Betrag siehst, antworte einfach auf diese E-Mail und wir prüfen es.`)}
    ${p(`Vielen Dank für deine Arbeit in diesem Monat.`)}
    ${p(`<em style="color:#64748b;">Dein Aprender-Aleman.de Team</em>`)}
  `;
  const footerNote = `Du erhältst diese E-Mail, weil deine Abrechnung auf der Aprender-Aleman.de-Plattform als bezahlt markiert wurde.`;

  const text = [
    `Hallo ${v.recipientName}!`,
    ``,
    `Wir haben deine Zahlung für ${v.monthLabel} bearbeitet.`,
    ``,
    `Zeitraum: ${v.monthLabel}`,
    `Betrag: ${v.amount}`,
    `Stunden: ${v.totalHours.toFixed(1)} h`,
    `Unterrichtseinheiten: ${v.classesCount}`,
    v.paymentMethod    ? `Zahlungsmethode: ${v.paymentMethod}` : "",
    v.paymentReference ? `Referenz: ${v.paymentReference}`     : "",
    ``,
    `Die vollständige Rechnung findest du als PDF im Anhang.`,
    ``,
    `Vielen Dank für deine Arbeit in diesem Monat.`,
    `Dein Aprender-Aleman.de Team`,
  ].filter(Boolean).join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
