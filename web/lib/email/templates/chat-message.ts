import { button, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Aviso mínimo de mensaje nuevo en el chat de la plataforma (Gelfis
 * 2026-10-30): solo "tienes un mensaje esperándote" y el botón al chat.
 * Sin remitente ni texto del mensaje, a petición de Gelfis. Mismo correo
 * para alumnos, profes y admins. Máximo uno cada 30 min por chat, ver
 * lib/chat-email-notify.ts.
 */
export type ChatMessageEmailVars = {
  name:     string;          // nombre de pila del destinatario
  chatUrl:  string;          // enlace absoluto que abre ese chat
  language: "es" | "de";
};

export function renderChatMessage(v: ChatMessageEmailVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: ChatMessageEmailVars): RenderedEmail {
  const subject = `💬 Tienes un mensaje nuevo en Aprender-Aleman.de`;
  const body = `
    ${h2(`Hola ${v.name} 👋`)}
    ${p(`Tienes un mensaje nuevo esperándote en el chat de la plataforma.`)}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.chatUrl, "Abrir el chat →")}
    </div>
  `;
  const footerNote = "Recibes este aviso porque tienes un mensaje nuevo en la plataforma. Si te llegan varios seguidos, solo te avisamos una vez cada 30 minutos.";
  const text = [
    `Hola ${v.name}!`,
    ``,
    `Tienes un mensaje nuevo esperándote en el chat de la plataforma.`,
    ``,
    `Abrir el chat: ${v.chatUrl}`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: ChatMessageEmailVars): RenderedEmail {
  const subject = `💬 Du hast eine neue Nachricht bei Aprender-Aleman.de`;
  const body = `
    ${h2(`Hallo ${v.name} 👋`)}
    ${p(`Im Chat der Plattform wartet eine neue Nachricht auf dich.`)}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.chatUrl, "Chat öffnen →")}
    </div>
  `;
  const footerNote = "Du erhältst diesen Hinweis, weil du eine neue Nachricht in der Plattform hast. Bei mehreren Nachrichten benachrichtigen wir dich höchstens alle 30 Minuten.";
  const text = [
    `Hallo ${v.name}!`,
    ``,
    `Im Chat der Plattform wartet eine neue Nachricht auf dich.`,
    ``,
    `Chat öffnen: ${v.chatUrl}`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
