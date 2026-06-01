import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Email "nudge" para leads que completaron el form pero NO dejaron
 * WhatsApp (Continuar sin WhatsApp). Se manda 5 veces escalando la
 * urgencia: T+30min, T+6h, T+24h, T+3d, T+7d.
 *
 * El CTA es siempre el mismo: link al funnel para retomar y dar el
 * WhatsApp (anclado en #wa para auto-focus del campo).
 */
export type EmailOnlyNudgeVars = {
  leadName: string;        // first name
  funnelUrl: string;       // ej. https://b2c.aprender-aleman.de/?resume=<lead_id>
  step:     1 | 2 | 3 | 4 | 5; // qué nudge es (1=T+30min, 5=T+7d)
};

const SUBJECTS: Record<EmailOnlyNudgeVars["step"], string> = {
  1: "Te falta un paso para tu clase de prueba 🚀",
  2: "Aún no has agendado tu clase, {name}",
  3: "Tu plan personalizado está listo, {name}",
  4: "Sigue ahí tu plan — ¿lo retomamos?",
  5: "Última oportunidad para tu clase gratis",
};

const HEADLINES: Record<EmailOnlyNudgeVars["step"], string> = {
  1: "¡Casi terminas, {name}!",
  2: "Te esperamos, {name} 👋",
  3: "Tu profesor está listo",
  4: "¿Sigues ahí?",
  5: "Última llamada antes de cerrar",
};

const BODIES: Record<EmailOnlyNudgeVars["step"], (name: string) => string> = {
  1: (name) => `
    ${p(`Hace un momento empezaste a crear tu plan personalizado de alemán, pero te faltó un paso pequeño: <strong>darnos tu WhatsApp</strong>.`)}
    ${p(`Lo necesitamos para enviarte el <strong>link del aula virtual</strong> y los recordatorios de tu clase de prueba (30 min antes). Sin WhatsApp no podemos reservarte un horario.`)}
    ${p(`Solo te llevará 20 segundos:`)}
  `,
  2: (name) => `
    ${p(`Veo que hace unas horas empezaste a crear tu plan, pero no llegaste a agendar tu clase de prueba gratis.`)}
    ${p(`¿Algún problema? Si fue el <strong>WhatsApp</strong> lo que te detuvo: solo lo usamos para enviarte el link del aula y los recordatorios. Cero spam, cero llamadas no deseadas.`)}
    ${p(`Aquí lo retomas con un click:`)}
  `,
  3: (name) => `
    ${p(`Ayer empezaste a configurar tu plan personalizado de alemán y no llegaste al final. Tu plan sigue guardado y un profesor nativo está disponible esta semana para tu clase de prueba <strong>gratuita</strong>.`)}
    ${p(`Para reservar tu horario solo necesitamos tu <strong>WhatsApp</strong> (lo usamos solo para el link del aula y recordatorios — cero spam).`)}
  `,
  4: (name) => `
    ${p(`Han pasado 3 días desde que empezaste a crear tu plan y no llegaste a agendar tu clase.`)}
    ${p(`Si quieres retomarlo, ahí sigue tu plan. Solo falta tu WhatsApp para reservar un horario con tu profesor:`)}
    ${p(`<em>(Si prefieres que te llamemos o coordinar por email, responde a este correo y Stiv te coordinará todo desde aquí.)</em>`)}
  `,
  5: (name) => `
    ${p(`Esta es la última vez que te escribo sobre esto, prometido.`)}
    ${p(`Hace una semana empezaste a crear tu plan de alemán y nunca llegaste a agendar tu clase de prueba. Si todavía te interesa, todo sigue ahí esperándote — solo necesitamos tu WhatsApp para reservar un horario:`)}
    ${p(`Si ya no es buen momento, también lo entiendo. Mucha suerte con tu camino para aprender alemán, ${escapeHtml(name)} 🇩🇪`)}
  `,
};

export function renderEmailOnlyNudge(v: EmailOnlyNudgeVars): RenderedEmail {
  const subject = SUBJECTS[v.step].replace(/\{name\}/g, v.leadName);
  const headline = HEADLINES[v.step].replace(/\{name\}/g, v.leadName);
  const bodyMain = BODIES[v.step](v.leadName);

  const body = `
    ${h2(`${escapeHtml(headline)}`)}
    ${bodyMain}
    <div style="text-align:center;margin:28px 0;">
      ${button(v.funnelUrl, "📱 Añadir mi WhatsApp y agendar →")}
    </div>
    ${p(`<em style="color:#64748b;">— Stiv · Aprender-Aleman.de</em>`)}
  `;

  const text = [
    `¡Hola ${v.leadName}!`,
    ``,
    v.step === 1
      ? "Hace un momento empezaste a crear tu plan personalizado de alemán pero te faltó un paso: darnos tu WhatsApp."
      : v.step === 5
        ? "Esta es la última vez que te escribo sobre esto. Hace una semana empezaste tu plan y no llegaste a agendar tu clase. Si todavía te interesa, todo sigue ahí esperándote:"
        : "Tu plan personalizado de alemán sigue guardado. Para reservar tu clase de prueba gratuita solo nos falta tu WhatsApp:",
    ``,
    `Retoma aquí: ${v.funnelUrl}`,
    ``,
    `— Stiv · Aprender-Aleman.de`,
  ].join("\n");

  return {
    subject,
    html: renderEnvelope(body, "Recibes este recordatorio porque empezaste a crear tu plan en Aprender-Aleman.de."),
    text,
  };
}
