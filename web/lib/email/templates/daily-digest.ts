import { escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type DailyDigestVars = {
  date:                  string;         // "2026-04-18"
  newLeads24h:           number;
  newStudents24h:        number;
  classesToday:          number;
  classesThisWeek:       number;
  revenueTodayCents:     number;
  revenueThisMonthCents: number;
  currency:              string;
  unpaidPayrollCents:    number;
  riskAlerts:            Array<{ subject: string; detail: string }>;
  adminUrl:              string;
};

export function renderDailyDigest(v: DailyDigestVars): RenderedEmail {
  const subject = `Digest diario · ${v.date} · ${v.newStudents24h} estudiantes, ${v.riskAlerts.length} alertas`;

  const body = `
    ${h2(`Resumen del día — ${v.date}`)}
    ${p(`Así está la academia hoy.`)}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Actividad 24h</div>
    ${kvBlock([
      ["Leads nuevos",         String(v.newLeads24h)],
      ["Estudiantes convertidos", String(v.newStudents24h)],
      ["Clases programadas hoy",  String(v.classesToday)],
      ["Clases esta semana",      String(v.classesThisWeek)],
    ])}

    <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.06em;">Finanzas</div>
    ${kvBlock([
      ["Ingresos hoy",             money(v.revenueTodayCents, v.currency)],
      ["Ingresos del mes",         money(v.revenueThisMonthCents, v.currency)],
      ["Nómina pendiente de pagar", money(v.unpaidPayrollCents, v.currency)],
    ])}

    ${v.riskAlerts.length > 0 ? `
      <div style="margin:18px 0 4px 0;font-size:13px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:0.06em;">🚨 Alertas (${v.riskAlerts.length})</div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:10px 0 20px 0;width:100%;">
        ${v.riskAlerts.slice(0, 10).map(a => `
          <tr><td style="padding:6px 0;border-bottom:1px solid #fed7aa;font-size:14px;">
            <strong style="color:#0f172a;">${escapeHtml(a.subject)}</strong><br>
            <span style="color:#64748b;font-size:13px;">${escapeHtml(a.detail)}</span>
          </td></tr>
        `).join("")}
      </table>
    ` : `${p(`<em style="color:#64748b;">Sin alertas. Buen día 🎉</em>`)}`}

    <div style="text-align:center;margin:28px 0 8px 0;">
      <a href="${v.adminUrl}" style="display:inline-block;padding:12px 22px;background:linear-gradient(135deg,#fb923c 0%,#f97316 100%);color:#ffffff;font-weight:700;text-decoration:none;border-radius:12px;font-size:14px;">
        Abrir panel de admin →
      </a>
    </div>
  `;

  const footerNote = `Resumen automático enviado cada día a las 19:00 (Berlín).`;
  const html = renderEnvelope(body, footerNote);

  const text = [
    `Resumen del día — ${v.date}`,
    ``,
    `Actividad 24h:`,
    `- Leads nuevos: ${v.newLeads24h}`,
    `- Estudiantes convertidos: ${v.newStudents24h}`,
    `- Clases hoy: ${v.classesToday}`,
    `- Clases esta semana: ${v.classesThisWeek}`,
    ``,
    `Finanzas:`,
    `- Ingresos hoy: ${money(v.revenueTodayCents, v.currency)}`,
    `- Ingresos del mes: ${money(v.revenueThisMonthCents, v.currency)}`,
    `- Nómina pendiente: ${money(v.unpaidPayrollCents, v.currency)}`,
    ``,
    v.riskAlerts.length > 0
      ? `Alertas (${v.riskAlerts.length}):\n${v.riskAlerts.slice(0, 10).map(a => `- ${a.subject}: ${a.detail}`).join("\n")}`
      : "Sin alertas.",
    ``,
    `Panel: ${v.adminUrl}`,
  ].join("\n");

  return { subject, html, text };
}

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}
