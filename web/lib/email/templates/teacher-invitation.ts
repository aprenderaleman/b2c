import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

export type TeacherInvitationVars = {
  /** Nombre del candidato — si no lo tenemos, saludo genérico. */
  name:  string | null;
  /** URL única de registro (con el code). */
  link:  string;
};

/**
 * Email de invitación a candidato a profesor (Gelfis 2026-08-02).
 * Copy fijo aprobado — solo interpola nombre y link.
 */
export function renderTeacherInvitation(v: TeacherInvitationVars): RenderedEmail {
  const subject = "Tu invitación a Aprender-Aleman.de 🎉";
  const saludo = v.name ? `¡Hola ${escapeHtml(v.name)}!` : "¡Hola!";

  const body = `
    ${h2(saludo)}
    ${p(`Bienvenido/a al equipo de <strong>Aprender-Aleman.de</strong>.`)}
    ${p(`Completa tu registro de profesor aquí (5 minutos) — tus condiciones acordadas ya están configuradas; solo necesitamos tus datos para activar tu cuenta y tus pagos.`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(v.link, "Completar mi registro →")}
    </div>
    ${p(`<em style="color:#64748b;">El enlace es personal y válido 14 días.</em>`)}
    ${p(`¡Nos vemos dentro!`)}
    ${p(`<em style="color:#64748b;">— Gelfis · Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Recibes este correo porque la academia te ha invitado a unirte como profesor.";

  const text = [
    v.name ? `¡Hola ${v.name}!` : "¡Hola!",
    ``,
    `Bienvenido/a al equipo de Aprender-Aleman.de.`,
    ``,
    `Completa tu registro de profesor aquí (5 minutos):`,
    v.link,
    ``,
    `Tus condiciones acordadas ya están configuradas; solo necesitamos`,
    `tus datos para activar tu cuenta y tus pagos.`,
    ``,
    `El enlace es personal y válido 14 días.`,
    ``,
    `¡Nos vemos dentro!`,
    `— Gelfis · Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
