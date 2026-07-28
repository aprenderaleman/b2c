import { escapeHtml, p, renderEnvelope, type RenderedEmail } from "./base";

export type VentaPendienteVars = {
  leadName: string;
  solicitanteName: string;
  solicitanteRol: string;
  packName: string;
  monto: string;
  approvalUrl: string;
};

export function renderVentaPendiente(v: VentaPendienteVars): RenderedEmail {
  const subject = `💰 Venta pendiente — ${v.leadName}`;

  const body = `
    <div style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#ffffff;padding:16px 22px;border-radius:14px;margin-bottom:18px;text-align:center;">
      <div style="font-size:20px;font-weight:800;">Venta pendiente de aprobacion</div>
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;width:140px;">Lead</td><td style="padding:6px 0;color:#0f172a;font-weight:700;">${escapeHtml(v.leadName)}</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;">Solicitado por</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.solicitanteName)} (${escapeHtml(v.solicitanteRol)})</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;">Pack</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(v.packName)}</td></tr>
      <tr><td style="padding:6px 0;color:#475569;font-weight:600;">Monto</td><td style="padding:6px 0;color:#0f172a;font-weight:700;">${escapeHtml(v.monto)}</td></tr>
    </table>

    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeHtml(v.approvalUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;">
        Revisar y aprobar
      </a>
    </div>

    ${p(`<em style="color:#64748b;font-size:12px;">Aprueba o rechaza lo antes posible para no demorar la conversion.</em>`)}
  `;

  const text = [
    `Venta pendiente de aprobacion`,
    ``,
    `Lead: ${v.leadName}`,
    `Solicitado por: ${v.solicitanteName} (${v.solicitanteRol})`,
    `Pack: ${v.packName}`,
    `Monto: ${v.monto}`,
    ``,
    `Aprobar: ${v.approvalUrl}`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, "Recibes este aviso como admin."), text };
}
