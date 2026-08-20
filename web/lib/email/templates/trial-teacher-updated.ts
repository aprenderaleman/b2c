import { escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Aviso al profe de que su clase de prueba fue reagendada o cancelada
 * (Gelfis 2026-08-19). Informativo corto — quién es el lead, qué
 * cambió, link al panel. Sin CTA extra.
 *
 * Se envía SOLO al teacher asignado. Si el teacher fue el actor mismo
 * (cancela su propia clase), el caller debe suprimirlo.
 */
export type TrialTeacherUpdatedVars = {
  kind:            "rescheduled" | "cancelled";
  teacherName:     string;   // "Sabine"
  leadName:        string;   // "María González"
  /** Fecha original pre-formateada, e.g. "viernes, 22 de agosto, 17:00 (Berlín)". */
  previousDate:    string;
  /** Fecha nueva pre-formateada. Requerida para rescheduled, ignorada en cancelled. */
  newDate?:        string;
  /** URL al panel del profe (/aula o /teacher/...) para ver el detalle. */
  panelUrl:        string;
  /** Quién disparó el cambio, para transparencia ("Gelfis (admin)", "María (lead)"). */
  actorLabel:      string;
};

export function renderTrialTeacherUpdated(v: TrialTeacherUpdatedVars): RenderedEmail {
  const subject = v.kind === "rescheduled"
    ? `📆 Clase con ${v.leadName} reagendada`
    : `❌ Clase con ${v.leadName} cancelada`;

  const lead        = escapeHtml(v.leadName);
  const teacher     = escapeHtml(v.teacherName);
  const prev        = escapeHtml(v.previousDate);
  const next        = escapeHtml(v.newDate ?? "");
  const actor       = escapeHtml(v.actorLabel);
  const url         = escapeHtml(v.panelUrl);

  const rows: Array<[string, string]> = v.kind === "rescheduled"
    ? [
        ["Estudiante", lead],
        ["Antes",      prev],
        ["Ahora",      next],
        ["Cambio por", actor],
      ]
    : [
        ["Estudiante", lead],
        ["Era",        prev],
        ["Cancelado por", actor],
      ];

  const intro = v.kind === "rescheduled"
    ? `Hola ${teacher}, la clase de prueba con <strong>${lead}</strong> se movió a otra fecha.`
    : `Hola ${teacher}, la clase de prueba con <strong>${lead}</strong> fue cancelada.`;

  const closing = v.kind === "rescheduled"
    ? `Ya está reflejado en tu calendario. Los detalles completos están en tu panel:`
    : `Ese hueco queda libre. Puedes verlo en tu panel:`;

  const body = [
    h2(v.kind === "rescheduled" ? "Cambio de fecha" : "Clase cancelada"),
    p(intro),
    kvBlock(rows),
    p(closing),
    p(`<a href="${url}" style="color:#f97316;text-decoration:underline;">Abrir panel</a>`),
  ].join("\n");

  const html = renderEnvelope(body, "Aviso automático. Responder este email llega al equipo.");

  const textLines = [
    v.kind === "rescheduled"
      ? `Hola ${v.teacherName}, la clase de prueba con ${v.leadName} se movió.`
      : `Hola ${v.teacherName}, la clase de prueba con ${v.leadName} fue cancelada.`,
    "",
    ...rows.map(([k, val]) => `${k}: ${val.replace(/<[^>]+>/g, "")}`),
    "",
    closing,
    v.panelUrl,
  ];

  return { subject, html, text: textLines.join("\n") };
}
