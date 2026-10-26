import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";
import type { LeadJoinUrl } from "@/lib/trial-token";

/**
 * Emails BREVES del setter (Gelfis 2026-10-26), gemelos de sus WhatsApps:
 *   - variant "link":      enlace de acceso al aula + instrucciones mínimas.
 *   - variant "confirmed": gracias por confirmar + enlace + "Wir sehen
 *                          uns am {fecha}".
 * Se envían justo después de que el setter habló con el lead por teléfono.
 */

export type SetterTrialAccessVars = {
  variant:   "link" | "confirmed";
  leadName:  string;
  /** Pre-formateada: "lunes, 27 de octubre, 15:30 (Berlín)". */
  startDate: string;
  joinUrl:   LeadJoinUrl;
  citaTipo:  "trial" | "sesion";
  language:  "es" | "de";
};

export function renderSetterTrialAccess(v: SetterTrialAccessVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: SetterTrialAccessVars): RenderedEmail {
  const clase = v.citaTipo === "sesion" ? "sesión de plan" : "clase de prueba";
  const name = escapeHtml(v.leadName);
  const date = escapeHtml(v.startDate);

  if (v.variant === "confirmed") {
    const subject = `¡Gracias por confirmar! Tu enlace para la ${clase}`;
    const body = `
      ${h2(`¡Gracias por confirmar, ${name}! 🙌`)}
      ${p(`Aquí tienes tu enlace para unirte a la ${clase}:`)}
      <div style="text-align:center;margin:22px 0 20px 0;">
        ${button(v.joinUrl, "Entrar a la clase →")}
      </div>
      ${p(`📅 <strong>${date}</strong>`)}
      ${p(`<strong>Wir sehen uns am ${date}! 🇩🇪</strong>`)}
    `;
    const text = [
      `¡Gracias por confirmar, ${v.leadName}! 🙌`,
      ``,
      `Tu enlace para unirte a la ${clase}: ${v.joinUrl}`,
      `📅 ${v.startDate}`,
      ``,
      `Wir sehen uns am ${v.startDate}!`,
      `— Aprender-Aleman.de`,
    ].join("\n");
    return { subject, html: renderEnvelope(body, `Tu ${clase} en Aprender-Aleman.de.`), text };
  }

  const subject = `Tu enlace para entrar a la ${clase}`;
  const body = `
    ${h2(`¡Hola ${name}! 👋`)}
    ${p(`Aquí tienes el enlace para entrar a tu ${clase} de alemán:`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(v.joinUrl, "Entrar a la clase →")}
    </div>
    ${p(`📅 <strong>${date}</strong>`)}
    ${p(`Entra 2-3 minutos antes, desde el móvil o el ordenador — solo haz clic en el botón, sin instalar nada.`)}
  `;
  const text = [
    `¡Hola ${v.leadName}! 👋`,
    ``,
    `Enlace para entrar a tu ${clase} de alemán: ${v.joinUrl}`,
    `📅 ${v.startDate}`,
    ``,
    `Entra 2-3 minutos antes, desde el móvil o el ordenador — solo haz clic en el enlace, sin instalar nada.`,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, `Tu ${clase} en Aprender-Aleman.de.`), text };
}

function renderDE(v: SetterTrialAccessVars): RenderedEmail {
  const clase = v.citaTipo === "sesion" ? "Plan-Session" : "Probestunde";
  const name = escapeHtml(v.leadName);
  const date = escapeHtml(v.startDate);

  if (v.variant === "confirmed") {
    const subject = `Danke für deine Bestätigung! Dein Link zur ${clase}`;
    const body = `
      ${h2(`Danke für deine Bestätigung, ${name}! 🙌`)}
      ${p(`Hier ist dein Link zur ${clase}:`)}
      <div style="text-align:center;margin:22px 0 20px 0;">
        ${button(v.joinUrl, "Zur Stunde →")}
      </div>
      ${p(`📅 <strong>${date}</strong>`)}
      ${p(`<strong>Wir sehen uns am ${date}! 🇩🇪</strong>`)}
    `;
    const text = [
      `Danke für deine Bestätigung, ${v.leadName}! 🙌`,
      ``,
      `Dein Link zur ${clase}: ${v.joinUrl}`,
      `📅 ${v.startDate}`,
      ``,
      `Wir sehen uns am ${v.startDate}!`,
      `— Aprender-Aleman.de`,
    ].join("\n");
    return { subject, html: renderEnvelope(body, `Deine ${clase} bei Aprender-Aleman.de.`), text };
  }

  const subject = `Dein Link zur ${clase}`;
  const body = `
    ${h2(`Hallo ${name}! 👋`)}
    ${p(`Hier ist dein Link zu deiner Deutsch-${clase}:`)}
    <div style="text-align:center;margin:22px 0 20px 0;">
      ${button(v.joinUrl, "Zur Stunde →")}
    </div>
    ${p(`📅 <strong>${date}</strong>`)}
    ${p(`Klick einfach 2-3 Minuten vorher auf den Button — Handy oder Computer, ohne Installation.`)}
  `;
  const text = [
    `Hallo ${v.leadName}! 👋`,
    ``,
    `Dein Link zu deiner Deutsch-${clase}: ${v.joinUrl}`,
    `📅 ${v.startDate}`,
    ``,
    `Klick einfach 2-3 Minuten vorher auf den Link — Handy oder Computer, ohne Installation.`,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, `Deine ${clase} bei Aprender-Aleman.de.`), text };
}
