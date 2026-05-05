import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Resumen matutino para clases regulares (no trials). Decisión Gelfis
 * 2026-05-04: a las 8am cada estudiante / profesor recibe UN solo email
 * con todas las clases que tiene ese día.
 *
 * Diseño: muy breve. Solo lo necesario (hora · título · contraparte).
 * El click sobre "Ver agenda" abre /estudiante/clases o /profesor/clases.
 */
export type ClassMorningEntry = {
  startTime:    string;        // "18:00"
  durationMin:  number;
  title:        string;
  partner:      string;        // student → "Florian"; teacher → "Lydia, Natalia"
  classUrl:     string;        // /aula/<id>
};

export type ClassMorningVars = {
  audience:     "student" | "teacher";
  recipientName: string;        // primer nombre
  classes:      ClassMorningEntry[];
  scheduleUrl:  string;         // /estudiante/clases o /profesor/clases
  language:     "es" | "de";
};

export function renderClassMorningSummary(v: ClassMorningVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: ClassMorningVars): RenderedEmail {
  const isStudent = v.audience === "student";
  const subject = isStudent
    ? `📚 Tienes clase hoy — ${v.classes.length} sesión${v.classes.length === 1 ? "" : "es"}`
    : `📚 Hoy das ${v.classes.length} clase${v.classes.length === 1 ? "" : "s"}`;

  const opener = isStudent
    ? `¡Hola ${escapeHtml(v.recipientName)}! ☀️ Hoy tienes:`
    : `¡Hola ${escapeHtml(v.recipientName)}! ☀️ Hoy das:`;

  const items = v.classes.map(c => `
    <li style="margin:8px 0;color:#0f172a;font-size:15px;">
      <strong>${escapeHtml(c.startTime)}</strong>
      &nbsp;·&nbsp;${escapeHtml(c.title)}
      &nbsp;·&nbsp;<span style="color:#64748b;">${isStudent ? "con " : "con "}${escapeHtml(c.partner)}</span>
    </li>`).join("");

  const body = `
    ${h2("☀️ Buenos días")}
    ${p(opener)}
    <ul style="list-style:none;padding:0;margin:14px 0;">${items}</ul>
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.scheduleUrl, isStudent ? "Ver mis clases →" : "Ver mi agenda →")}
    </div>
    ${p(`<em style="color:#64748b;">¡Que tengas un gran día!<br>— Aprender-Aleman.de</em>`)}
  `;

  const text = [
    `¡Hola ${v.recipientName}!`,
    isStudent ? "Hoy tienes:" : "Hoy das:",
    "",
    ...v.classes.map(c => `• ${c.startTime} · ${c.title} · con ${c.partner}`),
    "",
    `Ver: ${v.scheduleUrl}`,
    "",
    "— Aprender-Aleman.de",
  ].join("\n");

  return {
    subject,
    html: renderEnvelope(body, isStudent
      ? "Recibes este correo porque tienes una clase hoy. Para no recibir más, desactiva las notificaciones en tu perfil."
      : "Recibes este correo porque eres profesor con clases hoy. Para no recibir más, desactiva las notificaciones en tu perfil."),
    text,
  };
}

function renderDE(v: ClassMorningVars): RenderedEmail {
  const isStudent = v.audience === "student";
  const subject = isStudent
    ? `📚 Du hast heute Unterricht — ${v.classes.length} Sitzung${v.classes.length === 1 ? "" : "en"}`
    : `📚 Heute hast du ${v.classes.length} Stunde${v.classes.length === 1 ? "" : "n"}`;

  const opener = isStudent
    ? `Hallo ${escapeHtml(v.recipientName)}! ☀️ Heute steht an:`
    : `Hallo ${escapeHtml(v.recipientName)}! ☀️ Heute unterrichtest du:`;

  const items = v.classes.map(c => `
    <li style="margin:8px 0;color:#0f172a;font-size:15px;">
      <strong>${escapeHtml(c.startTime)}</strong>
      &nbsp;·&nbsp;${escapeHtml(c.title)}
      &nbsp;·&nbsp;<span style="color:#64748b;">mit ${escapeHtml(c.partner)}</span>
    </li>`).join("");

  const body = `
    ${h2("☀️ Guten Morgen")}
    ${p(opener)}
    <ul style="list-style:none;padding:0;margin:14px 0;">${items}</ul>
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.scheduleUrl, isStudent ? "Meine Stunden →" : "Mein Plan →")}
    </div>
    ${p(`<em style="color:#64748b;">Einen schönen Tag!<br>— Aprender-Aleman.de</em>`)}
  `;

  const text = [
    `Hallo ${v.recipientName}!`,
    isStudent ? "Heute steht an:" : "Heute unterrichtest du:",
    "",
    ...v.classes.map(c => `• ${c.startTime} · ${c.title} · mit ${c.partner}`),
    "",
    `Sehen: ${v.scheduleUrl}`,
    "",
    "— Aprender-Aleman.de",
  ].join("\n");

  return {
    subject,
    html: renderEnvelope(body, isStudent
      ? "Du erhältst diese E-Mail, weil du heute Unterricht hast. Zum Abmelden, in deinem Profil deaktivieren."
      : "Du erhältst diese E-Mail, weil du heute unterrichtest. Zum Abmelden, in deinem Profil deaktivieren."),
    text,
  };
}
