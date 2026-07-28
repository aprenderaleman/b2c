import { escapeHtml, p, renderEnvelope, type RenderedEmail } from "./base";

export type RankChangeVars = {
  userName: string;
  oldRank: string;
  newRank: string;
  rol: string;
  closeRate: number;
  conversiones: number;
  dashboardUrl: string;
};

export function renderRankChange(v: RankChangeVars): RenderedEmail {
  const isPromotion = rankOrder(v.newRank) > rankOrder(v.oldRank);
  const emoji = isPromotion ? "🎉" : "📉";
  const subject = `${emoji} Cambio de rango: ${v.oldRank} → ${v.newRank}`;

  const body = `
    <div style="background:${isPromotion ? "linear-gradient(135deg,#16a34a 0%,#15803d 100%)" : "linear-gradient(135deg,#64748b 0%,#475569 100%)"};color:#ffffff;padding:18px 22px;border-radius:14px;margin-bottom:18px;text-align:center;">
      <div style="font-size:28px;">${emoji}</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px;">
        ${isPromotion ? "Has subido de rango!" : "Tu rango ha cambiado"}
      </div>
    </div>

    ${p(`Hola ${escapeHtml(v.userName)},`)}
    ${p(`Tu rango como <strong>${escapeHtml(v.rol)}</strong> ha cambiado de <strong>${escapeHtml(v.oldRank)}</strong> a <strong>${escapeHtml(v.newRank)}</strong>.`)}

    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      <tr>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:8px 0 0 8px;font-weight:600;color:#475569;">Close rate</td>
        <td style="padding:8px 12px;background:#f1f5f9;border-radius:0 8px 8px 0;font-weight:700;color:#0f172a;text-align:right;">${v.closeRate.toFixed(1)}%</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#475569;">Conversiones</td>
        <td style="padding:8px 12px;font-weight:700;color:#0f172a;text-align:right;">${v.conversiones}</td>
      </tr>
    </table>

    ${isPromotion ? p("Felicidades! Sigue asi.") : p("Revisa tus estadisticas para volver a subir.")}

    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeHtml(v.dashboardUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;">
        Ver mis numeros
      </a>
    </div>
  `;

  const text = [
    `${emoji} Cambio de rango`,
    ``,
    `Hola ${v.userName},`,
    `Tu rango como ${v.rol} ha cambiado: ${v.oldRank} → ${v.newRank}.`,
    `Close rate: ${v.closeRate.toFixed(1)}%`,
    `Conversiones: ${v.conversiones}`,
    ``,
    `Ver numeros: ${v.dashboardUrl}`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, "Recibes esta notificacion por tu actividad como " + v.rol + "."), text };
}

function rankOrder(r: string): number {
  const order: Record<string, number> = { starter: 0, rookie: 0, pro: 1, closer: 1, elite: 2, master: 3 };
  return order[r.toLowerCase()] ?? 0;
}
