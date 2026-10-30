import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Aviso breve de mensaje nuevo en el chat de la plataforma (Gelfis
 * 2026-10-30). Mismo correo para alumnos, profes y admins; `author` ya
 * viene con el alias que ve ese destinatario (p. ej. "Stiv (Asistente)"
 * para alumnos). Máximo uno cada 30 min por chat, ver chat-email-notify.
 */
export type ChatMessageEmailVars = {
  name:      string;          // nombre de pila del destinatario
  author:    string;          // quién escribió (alias según destinatario)
  groupName: string | null;   // título del grupo si es chat grupal
  preview:   string;          // texto recortado del mensaje (o "📎 archivo")
  chatUrl:   string;          // enlace absoluto que abre ese chat
  language:  "es" | "de";
};

export function renderChatMessage(v: ChatMessageEmailVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function quote(text: string): string {
  return `<blockquote style="margin:0 0 18px 0;padding:12px 16px;border-left:4px solid #fb923c;background:#fff7ed;border-radius:0 12px 12px 0;font-size:15px;color:#0f172a;white-space:pre-wrap;">${escapeHtml(text)}</blockquote>`;
}

function renderES(v: ChatMessageEmailVars): RenderedEmail {
  const where = v.groupName ? ` en el grupo <strong>${escapeHtml(v.groupName)}</strong>` : "";
  const subject = v.groupName
    ? `💬 ${v.author} ha escrito en ${v.groupName}`
    : `💬 Nuevo mensaje de ${v.author}`;
  const body = `
    ${h2(`Hola ${v.name} 👋`)}
    ${p(`<strong>${escapeHtml(v.author)}</strong> te ha escrito${where} en el chat de Aprender-Aleman.de:`)}
    ${quote(v.preview)}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.chatUrl, "Abrir el chat →")}
    </div>
    ${p(`<em style="color:#64748b;">Responde desde la plataforma, no a este correo.</em>`)}
  `;
  const footerNote = "Recibes este aviso porque tienes un mensaje nuevo en la plataforma. Si te llegan varios seguidos, solo te avisamos una vez cada 30 minutos.";
  const text = [
    `Hola ${v.name}!`,
    ``,
    `${v.author} te ha escrito${v.groupName ? ` en el grupo ${v.groupName}` : ""} en el chat de Aprender-Aleman.de:`,
    ``,
    `"${v.preview}"`,
    ``,
    `Abrir el chat: ${v.chatUrl}`,
    ``,
    `Responde desde la plataforma, no a este correo.`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: ChatMessageEmailVars): RenderedEmail {
  const where = v.groupName ? ` in der Gruppe <strong>${escapeHtml(v.groupName)}</strong>` : "";
  const subject = v.groupName
    ? `💬 ${v.author} hat in ${v.groupName} geschrieben`
    : `💬 Neue Nachricht von ${v.author}`;
  const body = `
    ${h2(`Hallo ${v.name} 👋`)}
    ${p(`<strong>${escapeHtml(v.author)}</strong> hat dir${where} im Chat von Aprender-Aleman.de geschrieben:`)}
    ${quote(v.preview)}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.chatUrl, "Chat öffnen →")}
    </div>
    ${p(`<em style="color:#64748b;">Antworte in der Plattform, nicht auf diese E-Mail.</em>`)}
  `;
  const footerNote = "Du erhältst diesen Hinweis, weil du eine neue Nachricht in der Plattform hast. Bei mehreren Nachrichten benachrichtigen wir dich höchstens alle 30 Minuten.";
  const text = [
    `Hallo ${v.name}!`,
    ``,
    `${v.author} hat dir${v.groupName ? ` in der Gruppe ${v.groupName}` : ""} im Chat von Aprender-Aleman.de geschrieben:`,
    ``,
    `"${v.preview}"`,
    ``,
    `Chat öffnen: ${v.chatUrl}`,
    ``,
    `Antworte in der Plattform, nicht auf diese E-Mail.`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
