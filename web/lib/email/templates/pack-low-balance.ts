import { type RenderedEmail, renderEnvelope, escapeHtml, h2, p, button } from "./base";

export type PackLowBalanceVars = {
  name:             string;
  remaining:        number;
  whatsappUrl:      string;
};

export function renderPackLowBalance(vars: PackLowBalanceVars): RenderedEmail {
  const { name, remaining, whatsappUrl } = vars;
  const firstName = escapeHtml(name.split(" ")[0]);

  const subject = `Te quedan ${remaining} clases en tu plan`;

  const body = [
    h2(`Hola, ${firstName}!`),
    p(`Te escribimos para avisarte que te quedan <strong>${remaining} clases</strong> en tu plan actual.`),
    p("Para que no se interrumpa tu progreso en alemán, te recomendamos coordinar los siguientes pasos con tiempo."),
    p("Escríbele a <strong>Gelfis Horn</strong> para renovar tu plan o resolver cualquier duda:"),
    `<div style="text-align:center;margin:20px 0;">`,
    button(whatsappUrl, "Escribir a Gelfis por WhatsApp"),
    `</div>`,
    p(`O escríbenos a <a href="mailto:info@aprender-aleman.de" style="color:#ea580c;text-decoration:none;font-weight:600;">info@aprender-aleman.de</a>`),
    p("Seguimos con todo — cada clase cuenta!"),
    p("Tu equipo de <strong>Aprender-Aleman.de</strong>"),
  ].join("\n");

  const html = renderEnvelope(body, "Este email se envía automáticamente cuando quedan pocas clases en tu plan.");

  const text = `Hola, ${name.split(" ")[0]}!

Te escribimos para avisarte que te quedan ${remaining} clases en tu plan actual.

Para que no se interrumpa tu progreso en alemán, te recomendamos coordinar los siguientes pasos con tiempo.

Escríbele a Gelfis Horn para renovar tu plan o resolver cualquier duda:
- WhatsApp: ${whatsappUrl}
- Email: info@aprender-aleman.de

Seguimos con todo — cada clase cuenta!

Tu equipo de Aprender-Aleman.de`;

  return { subject, html, text };
}
