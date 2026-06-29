import { type RenderedEmail, renderEnvelope, escapeHtml, h2, p, button } from "./base";

export type PackCompletedVars = {
  name:             string;
  totalClasses:     number;
  whatsappUrl:      string;
};

export function renderPackCompleted(vars: PackCompletedVars): RenderedEmail {
  const { name, totalClasses, whatsappUrl } = vars;
  const firstName = escapeHtml(name.split(" ")[0]);

  const subject = `Has completado tu plan — felicidades, ${name.split(" ")[0]}!`;

  const body = [
    h2(`Felicidades, ${firstName}!`),
    p(`Has completado las <strong>${totalClasses} clases</strong> de tu plan.`),
    p(`Nos encantaría saber: <strong>¿cómo ha sido tu experiencia en la academia?</strong> ¿Cómo sientes que ha mejorado tu alemán desde que empezaste?`),
    p("Tu opinión nos ayuda a seguir mejorando."),
    p("Para continuar avanzando con tu alemán, escríbele a <strong>Gelfis Horn</strong> y juntos vemos los siguientes pasos:"),
    `<div style="text-align:center;margin:20px 0;">`,
    button(whatsappUrl, "Escribir a Gelfis por WhatsApp"),
    `</div>`,
    p(`O escríbenos a <a href="mailto:info@aprender-aleman.de" style="color:#ea580c;text-decoration:none;font-weight:600;">info@aprender-aleman.de</a>`),
    p("Gracias por confiar en nosotros — ha sido un gusto acompañarte en este camino!"),
    p("Tu equipo de <strong>Aprender-Aleman.de</strong>"),
  ].join("\n");

  const html = renderEnvelope(body, "Este email se envía al completar tu plan de clases.");

  const text = `Felicidades, ${name.split(" ")[0]}!

Has completado las ${totalClasses} clases de tu plan.

Nos encantaría saber: ¿cómo ha sido tu experiencia en la academia? ¿Cómo sientes que ha mejorado tu alemán desde que empezaste?

Tu opinión nos ayuda a seguir mejorando.

Para continuar avanzando con tu alemán, escríbele a Gelfis Horn y juntos vemos los siguientes pasos:
- WhatsApp: ${whatsappUrl}
- Email: info@aprender-aleman.de

Gracias por confiar en nosotros — ha sido un gusto acompañarte en este camino!

Tu equipo de Aprender-Aleman.de`;

  return { subject, html, text };
}
