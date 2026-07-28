import { escapeHtml, p, renderEnvelope, type RenderedEmail } from "./base";

export type CloserDailyDigestVars = {
  closerName: string;
  tareasHoy: number;
  tareasAtrasadas: number;
  leadsActivos: number;
  closeRate: number;
  ventasPendientes: number;
  dashboardUrl: string;
};

export function renderCloserDailyDigest(v: CloserDailyDigestVars): RenderedEmail {
  const subject = `📋 Tu resumen del dia — ${v.tareasHoy} tareas pendientes`;

  const body = `
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:16px;">
      Buenos dias, ${escapeHtml(v.closerName)}
    </div>

    ${p("Aqui tienes tu resumen de hoy:")}

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:8px 0 0 0;font-weight:600;color:#475569;">Tareas hoy</td>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 8px 0 0;font-weight:700;color:#0f172a;text-align:right;">${v.tareasHoy}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#475569;">Tareas atrasadas</td>
        <td style="padding:8px 12px;font-weight:700;color:${v.tareasAtrasadas > 0 ? "#dc2626" : "#16a34a"};text-align:right;">${v.tareasAtrasadas}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;color:#475569;">Leads activos</td>
        <td style="padding:8px 12px;background:#f1f5f9;font-weight:700;color:#0f172a;text-align:right;">${v.leadsActivos}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#475569;">Close rate</td>
        <td style="padding:8px 12px;font-weight:700;color:#0f172a;text-align:right;">${v.closeRate.toFixed(1)}%</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 0 0 8px;font-weight:600;color:#475569;">Ventas pendientes</td>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 0 8px 0;font-weight:700;color:#0f172a;text-align:right;">${v.ventasPendientes}</td>
      </tr>
    </table>

    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeHtml(v.dashboardUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;">
        Ver mi panel
      </a>
    </div>
  `;

  const text = [
    `Buenos dias, ${v.closerName}`,
    ``,
    `Tareas hoy: ${v.tareasHoy}`,
    `Tareas atrasadas: ${v.tareasAtrasadas}`,
    `Leads activos: ${v.leadsActivos}`,
    `Close rate: ${v.closeRate.toFixed(1)}%`,
    `Ventas pendientes: ${v.ventasPendientes}`,
    ``,
    `Ver panel: ${v.dashboardUrl}`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, "Recibes este digest como closer activo."), text };
}
