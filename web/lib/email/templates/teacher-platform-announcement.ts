import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * "La nueva plataforma ya está lista" — announcement sent to each
 * active teacher ahead of the Zoom→B2C cutover on 2026-04-27.
 *
 * One-off broadcast triggered from /admin/broadcast. Content was
 * approved word-for-word by Gelfis before this template shipped.
 */
export type PlatformAnnouncementVars = {
  name:         string;                 // teacher's display name
  email:        string;                 // shown in the "accesos" block
  platformUrl:  string;                 // login URL
  videoUrl:     string;                 // YouTube tutorial
  cutoverDate:  string;                 // e.g. "lunes 27 de abril"
};

export function renderTeacherPlatformAnnouncement(
  v: PlatformAnnouncementVars,
): RenderedEmail {
  const subject = "La nueva plataforma ya está lista — empezamos el lunes 🚀";

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}! 👋`)}
    ${p(`¡Ya está lista la nueva plataforma de la academia! Todo lo que necesitas para dar clase en un solo sitio: aula en vivo, estudiantes, clases, materiales, grabaciones y facturación.`)}
    ${p(`Te he preparado un vídeo donde te explico <strong>paso a paso</strong> cómo usarla:`)}
    <div style="text-align:center;margin:22px 0;">
      ${button(v.videoUrl, "🎥 Ver el vídeo tutorial →")}
    </div>

    <h2 style="font-size:15px;font-weight:700;margin:28px 0 8px 0;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;">Tus accesos</h2>
    ${kvBlock([
      ["Plataforma",  `<a href="${v.platformUrl}" style="color:#ea580c;text-decoration:none;">${escapeHtml(v.platformUrl)}</a>`],
      ["Usuario",     escapeHtml(v.email)],
      ["Contraseña",  `La que ya tenías. Si no la recuerdas, pulsa <em>"Olvidé mi contraseña"</em> en el login o avísame y te la reseteo al instante.`],
    ])}
    <div style="text-align:center;margin:6px 0 22px 0;">
      ${button(v.platformUrl, "Entrar a la plataforma →")}
    </div>

    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:14px 16px;margin:18px 0;">
      <p style="margin:0;font-size:14px;color:#9a3412;">
        <strong>⚠️ Importante:</strong> a partir del <strong>${escapeHtml(v.cutoverDate)}</strong>
        dejamos de usar Zoom. Tienes esta semana para probar todo con calma
        y familiarizarte con la plataforma.
      </p>
    </div>

    ${p(`Si te surge cualquier duda me escribes — por WhatsApp, respondiendo a este mismo email, o como prefieras.`)}
    ${p(`¡Gracias por el esfuerzo y nos hablamos!`)}
    ${p(`Un abrazo,<br><em style="color:#64748b;">— Gelfis</em>`)}
  `;

  const footerNote =
    "Recibes este correo porque eres profesor/a en Aprender-Aleman.de. " +
    "Si quieres responder, puedes hacerlo directamente a este email.";

  const text = [
    `¡Hola ${v.name}!`,
    ``,
    `¡Ya está lista la nueva plataforma de la academia! Todo lo que necesitas para dar clase en un solo sitio: aula en vivo, estudiantes, clases, materiales, grabaciones y facturación.`,
    ``,
    `Te he preparado un vídeo donde te explico paso a paso cómo usarla:`,
    v.videoUrl,
    ``,
    `--- Tus accesos ---`,
    `Plataforma:  ${v.platformUrl}`,
    `Usuario:     ${v.email}`,
    `Contraseña:  La que ya tenías. Si no la recuerdas, pulsa "Olvidé mi contraseña" en el login o avísame y te la reseteo al instante.`,
    ``,
    `IMPORTANTE: a partir del ${v.cutoverDate} dejamos de usar Zoom. Tienes esta semana para probar todo con calma y familiarizarte con la plataforma.`,
    ``,
    `Si te surge cualquier duda me escribes — por WhatsApp, respondiendo a este mismo email, o como prefieras.`,
    ``,
    `¡Gracias por el esfuerzo y nos hablamos!`,
    ``,
    `Un abrazo,`,
    `— Gelfis`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
