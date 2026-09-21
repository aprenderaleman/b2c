import { type RenderedEmail, renderEnvelope, escapeHtml, h2, p, button } from "./base";

export type PackMilestoneVars = {
  name:        string;
  subject:     string;   // ya renderizado (variables sustituidas)
  bodyText:    string;   // ya renderizado; párrafos separados por \n
  whatsappUrl: string;
};

/** Email de hito (10 / 5 / 0 clases restantes), firmado por Stiv. */
export function renderPackMilestone(vars: PackMilestoneVars): RenderedEmail {
  const firstName = escapeHtml(vars.name.split(" ")[0]);
  const paragraphs = vars.bodyText.split("\n").map(s => s.trim()).filter(Boolean);

  const body = [
    h2(`¡Hola, ${firstName}!`),
    ...paragraphs.map(t => p(escapeHtml(t))),
    `<div style="text-align:center;margin:20px 0;">`,
    button(vars.whatsappUrl, "Escribir a Stiv por WhatsApp"),
    `</div>`,
    p("— <strong>Stiv</strong> · Aprender-Aleman.de"),
  ].join("\n");

  const html = renderEnvelope(body, "Este mensaje se envía automáticamente según las clases que te quedan en tu plan.");
  const text = `¡Hola, ${vars.name.split(" ")[0]}!\n\n${paragraphs.join("\n\n")}\n\nWhatsApp: ${vars.whatsappUrl}\n\n— Stiv · Aprender-Aleman.de`;

  return { subject: vars.subject, html, text };
}
