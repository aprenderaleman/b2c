import { escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Aviso al closer de que su Sesión de Plan-Alemán fue reagendada o
 * cancelada (Gelfis 2026-08-19). Informativo corto — quién, qué
 * cambió, link al panel closer.
 *
 * Se envía SOLO al closer asignado a la sesión. Si el closer fue el
 * actor mismo, el caller debe suprimirlo.
 */
export type SesionCloserUpdatedVars = {
  kind:            "rescheduled" | "cancelled";
  closerName:      string;   // "Stiv"
  leadName:        string;   // "Ivette Aguilera"
  previousDate:    string;   // pre-formateado Berlin
  newDate?:        string;   // solo rescheduled
  panelUrl:        string;   // /closer o /closer/leads/[id]
  actorLabel:      string;
};

export function renderSesionCloserUpdated(v: SesionCloserUpdatedVars): RenderedEmail {
  const subject = v.kind === "rescheduled"
    ? `📆 Sesión con ${v.leadName} reagendada`
    : `❌ Sesión con ${v.leadName} cancelada`;

  const lead        = escapeHtml(v.leadName);
  const closer      = escapeHtml(v.closerName);
  const prev        = escapeHtml(v.previousDate);
  const next        = escapeHtml(v.newDate ?? "");
  const actor       = escapeHtml(v.actorLabel);
  const url         = escapeHtml(v.panelUrl);

  const rows: Array<[string, string]> = v.kind === "rescheduled"
    ? [
        ["Lead",       lead],
        ["Antes",      prev],
        ["Ahora",      next],
        ["Cambio por", actor],
      ]
    : [
        ["Lead",       lead],
        ["Era",        prev],
        ["Cancelado por", actor],
      ];

  const intro = v.kind === "rescheduled"
    ? `Hola ${closer}, la Sesión de Plan-Alemán con <strong>${lead}</strong> se movió a otra fecha.`
    : `Hola ${closer}, la Sesión de Plan-Alemán con <strong>${lead}</strong> fue cancelada.`;

  const closing = v.kind === "rescheduled"
    ? `Ya está reflejado en tu calendario. Detalles en tu panel:`
    : `Ese hueco queda libre. Puedes verlo en tu panel:`;

  const body = [
    h2(v.kind === "rescheduled" ? "Cambio de fecha" : "Sesión cancelada"),
    p(intro),
    kvBlock(rows),
    p(closing),
    p(`<a href="${url}" style="color:#f97316;text-decoration:underline;">Abrir panel</a>`),
  ].join("\n");

  const html = renderEnvelope(body, "Aviso automático. Responder este email llega al equipo.");

  const textLines = [
    v.kind === "rescheduled"
      ? `Hola ${v.closerName}, la Sesión de Plan-Alemán con ${v.leadName} se movió.`
      : `Hola ${v.closerName}, la Sesión de Plan-Alemán con ${v.leadName} fue cancelada.`,
    "",
    ...rows.map(([k, val]) => `${k}: ${val.replace(/<[^>]+>/g, "")}`),
    "",
    closing,
    v.panelUrl,
  ];

  return { subject, html, text: textLines.join("\n") };
}
