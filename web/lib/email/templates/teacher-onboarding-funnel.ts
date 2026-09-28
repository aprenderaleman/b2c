import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type TeacherOnboardingFunnelVars = {
  name:           string;
  email:          string;
  setPasswordUrl: string;
  validDays:      number;
  platformUrl:    string;
};

/**
 * Acceso a la plataforma para un profe que se incorpora a la campaña de
 * clases de prueba (/clase-profe): crear contraseña, marcar
 * disponibilidad y vincular Google Calendar.
 */
export function renderTeacherOnboardingFunnel(v: TeacherOnboardingFunnelVars): RenderedEmail {
  const subject = "Tu acceso a la plataforma de Aprender-Aleman.de";
  const disponibilidad = `${v.platformUrl}/profesor/disponibilidad`;
  const panel = `${v.platformUrl}/profesor`;
  const login = `${v.platformUrl}/login`;

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.name)}!`)}
    ${p(`Ya tienes tu cuenta de profe activa en <strong>Aprender-Aleman.de</strong>. Vamos a empezar a enviarte clases de prueba de alumnos nuevos, así que necesitamos que dejes tu cuenta lista con estos 3 pasos (unos 10 minutos).`)}
    ${p(`<strong>1. Crea tu contraseña</strong>`)}
    <div style="text-align:center;margin:14px 0 14px 0;">
      ${button(v.setPasswordUrl, "Crear mi contraseña →")}
    </div>
    ${kvBlock([["Tu usuario", escapeHtml(v.email)], ["Acceso", escapeHtml(login)]])}
    ${p(`<em style="color:#64748b;">El enlace es personal y válido ${v.validDays} días. Si caduca, usa "¿Olvidaste tu contraseña?" en la pantalla de acceso.</em>`)}
    ${p(`<strong>2. Marca tu disponibilidad</strong><br>En <a href="${disponibilidad}">${escapeHtml(disponibilidad)}</a> indica las franjas (hora de Berlín) en las que puedes dar clases de prueba. Puedes poner varias franjas el mismo día. Los alumnos solo podrán reservar contigo dentro de esas franjas, así que cuanto más abras, más clases recibirás.`)}
    ${p(`<strong>3. Vincula tu Google Calendar (recomendado)</strong><br>En tu panel, <a href="${panel}">${escapeHtml(panel)}</a>, pulsa "Vincular Google Calendar". Así las clases se añaden solas a tu calendario y nadie podrá reservar encima de un compromiso personal tuyo.`)}
    ${p(`Cuando tengas la disponibilidad marcada, avísanos y activamos tus clases de prueba. Si tienes cualquier duda, escríbenos a info@aprender-aleman.de.`)}
    ${p(`<em style="color:#64748b;">El equipo de Aprender-Aleman.de</em>`)}
  `;
  const footerNote = "Recibes este correo porque tu cuenta de profe en Aprender-Aleman.de fue activada.";

  const text = [
    `¡Hola ${v.name}!`,
    ``,
    `Ya tienes tu cuenta de profe activa en Aprender-Aleman.de. Vamos a empezar a enviarte clases de prueba de alumnos nuevos. Déjala lista con estos 3 pasos:`,
    ``,
    `1. Crea tu contraseña (enlace válido ${v.validDays} días):`,
    v.setPasswordUrl,
    `Tu usuario: ${v.email}`,
    `Acceso: ${login}`,
    ``,
    `2. Marca tu disponibilidad (hora de Berlín): ${disponibilidad}`,
    ``,
    `3. Vincula tu Google Calendar (recomendado): en ${panel} pulsa "Vincular Google Calendar".`,
    ``,
    `Cuando tengas la disponibilidad marcada, avísanos. Si tienes dudas, escríbenos a info@aprender-aleman.de.`,
    ``,
    `El equipo de Aprender-Aleman.de`,
  ].join("\n");

  return { subject, html: renderEnvelope(body, footerNote), text };
}
