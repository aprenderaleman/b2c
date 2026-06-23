import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Class-lifecycle email — replaces the WhatsApp pings the teacher /
 * admin / class-edit routes used to fire to active students and
 * teachers when a class was created, rescheduled or cancelled.
 *
 * Single channel (email) for active-account class events. Trial-class
 * leads still get WhatsApp at the booking moment + 30-min ping; this
 * template is only for users with an account (students, teachers).
 */
export type ClassLifecycleVars = {
  audience:    "student" | "teacher";
  kind:        "created" | "rescheduled" | "cancelled";
  recipientName: string;             // first name only ("Juan", "Sabine")
  classTitle:    string;             // class.title from DB
  startDate:     string;             // pre-formatted "lunes 28 de abril, 09:15 (Berlín)"
  durationMin:   number;             // class.duration_minutes
  count?:        number;             // 1 for single class, >1 for series (admin only)
  classUrl:      string;             // platform link to the class detail
  language:      "es" | "de";
};

export function renderClassLifecycle(v: ClassLifecycleVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

// ─────────────────────────────────────────────────────────
// SUBJECT lines per kind × audience × language
// ─────────────────────────────────────────────────────────

function subject(v: ClassLifecycleVars): string {
  const isTeacher = v.audience === "teacher";
  const series    = (v.count ?? 1) > 1;
  if (v.language === "de") {
    if (v.kind === "created")
      return isTeacher
        ? (series ? `📚 Neue Stundenreihe agendiert: ${v.classTitle}` : `📚 Neue Stunde agendiert: ${v.classTitle}`)
        : (series ? `🎉 Deine Stundenreihe ist bereit: ${v.classTitle}` : `🎉 Deine Stunde ist bereit: ${v.classTitle}`);
    if (v.kind === "rescheduled")
      return `📅 Stunde verschoben: ${v.classTitle} — ${v.startDate}`;
    return `❌ Stunde abgesagt: ${v.classTitle}`;
  }
  if (v.kind === "created")
    return isTeacher
      ? (series ? `📚 Nueva serie agendada: ${v.classTitle}` : `📚 Nueva clase agendada: ${v.classTitle}`)
      : (series ? `🎉 Tu serie de clases está lista: ${v.classTitle}` : `🎉 Tu clase está lista: ${v.classTitle}`);
  if (v.kind === "rescheduled")
    return `📅 Clase reprogramada: ${v.classTitle} — ${v.startDate}`;
  return `❌ Clase cancelada: ${v.classTitle}`;
}

// ─────────────────────────────────────────────────────────
// BODY copy
// ─────────────────────────────────────────────────────────

function openerES(v: ClassLifecycleVars): string {
  const titleStrong = `<strong>${escapeHtml(v.classTitle)}</strong>`;
  const series = (v.count ?? 1) > 1;
  if (v.kind === "created") {
    return v.audience === "teacher"
      ? (series
          ? `Te confirmamos la nueva serie de clases ${titleStrong} (${v.count} en total). Tienes el detalle abajo y todas en tu panel.`
          : `Te confirmamos la nueva clase ${titleStrong}. Tienes el detalle abajo y la encuentras también en tu panel.`)
      : (series
          ? `Tu serie de clases ${titleStrong} está agendada (${v.count} sesiones). Te enviaremos un recordatorio antes de cada una.`
          : `Tu clase ${titleStrong} está agendada. Te enviaremos un recordatorio antes de que empiece.`);
  }
  if (v.kind === "rescheduled") {
    return v.audience === "teacher"
      ? `Has reprogramado tu clase ${titleStrong} para la nueva fecha indicada abajo.`
      : `Tu clase ${titleStrong} ha sido reprogramada. Apunta la nueva fecha y nos vemos.`;
  }
  return v.audience === "teacher"
    ? `Has cancelado tu clase ${titleStrong}.`
    : `Tu clase ${titleStrong} ha sido cancelada. Tu profesor te contactará para reagendar si procede.`;
}

function openerDE(v: ClassLifecycleVars): string {
  const titleStrong = `<strong>${escapeHtml(v.classTitle)}</strong>`;
  const series = (v.count ?? 1) > 1;
  if (v.kind === "created") {
    return v.audience === "teacher"
      ? (series
          ? `Wir bestätigen deine neue Stundenreihe ${titleStrong} (${v.count} insgesamt). Details unten, alle Stunden auch in deinem Bereich.`
          : `Wir bestätigen deine neue Stunde ${titleStrong}. Details unten, du findest sie auch in deinem Bereich.`)
      : (series
          ? `Deine Stundenreihe ${titleStrong} ist agendiert (${v.count} Termine). Vor jeder Stunde bekommst du eine Erinnerung.`
          : `Deine Stunde ${titleStrong} ist agendiert. Vor dem Start senden wir dir eine Erinnerung.`);
  }
  if (v.kind === "rescheduled") {
    return v.audience === "teacher"
      ? `Du hast deine Stunde ${titleStrong} auf den neuen Termin unten verschoben.`
      : `Deine Stunde ${titleStrong} wurde verschoben. Bitte den neuen Termin merken.`;
  }
  return v.audience === "teacher"
    ? `Du hast deine Stunde ${titleStrong} abgesagt.`
    : `Deine Stunde ${titleStrong} wurde abgesagt. Dein Lehrer meldet sich zur Neuvereinbarung.`;
}

function ctaLabelES(v: ClassLifecycleVars): string {
  if (v.kind === "cancelled") return "Ver detalles";
  return v.audience === "teacher" ? "Ver clase en mi panel →" : "Ver clase en mi panel →";
}
function ctaLabelDE(v: ClassLifecycleVars): string {
  if (v.kind === "cancelled") return "Details ansehen";
  return v.audience === "teacher" ? "Stunde im Bereich →" : "Stunde im Bereich →";
}

// ─────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────

function renderES(v: ClassLifecycleVars): RenderedEmail {
  // Para el caso "estudiante / clase agendada" añadimos instrucciones
  // claras de cómo unirse el día de la clase (Gelfis 2026-06-23).
  const joinInstructionsES = (v.audience === "student" && v.kind === "created")
    ? `${h2(`Cómo unirte el día de la clase`)}
       ${p(`<strong>5 minutos antes</strong>, entra a tu panel y pulsa <strong>“Entrar al aula”</strong>. No hace falta instalar nada — el aula se abre directamente en el navegador.`)}
       ${p(`Antes de empezar, asegúrate de tener:`)}
       ${p(`• Buena conexión a internet<br>• Cámara y micrófono funcionando<br>• Un sitio tranquilo durante la clase`)}`
    : "";
  const body = `
    ${h2(`¡Hola ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(openerES(v))}
    ${kvBlock([
      [v.kind === "rescheduled" ? "📅 Nueva fecha" : v.kind === "cancelled" ? "📅 Estaba agendada" : "📅 Fecha", escapeHtml(v.startDate)],
      ["⏱ Duración", `${v.durationMin} minutos`],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.classUrl, ctaLabelES(v))}
    </div>
    ${joinInstructionsES}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote = v.audience === "teacher"
    ? "Recibes este correo porque eres el profesor/a asignado/a a esta clase."
    : "Recibes este correo porque tienes esta clase en tu plan de estudios.";
  const plainJoinES = (v.audience === "student" && v.kind === "created")
    ? [
        `Cómo unirte el día de la clase:`,
        `5 minutos antes, entra a tu panel y pulsa "Entrar al aula".`,
        `No hace falta instalar nada — el aula se abre en el navegador.`,
        `Necesitas: buena conexión, cámara y micrófono, lugar tranquilo.`,
        ``,
      ]
    : [];
  const text = [
    `¡Hola ${v.recipientName}!`, ``,
    plainOpenerES(v),
    `Fecha: ${v.startDate}`,
    `Duración: ${v.durationMin} min`, ``,
    `Ver detalles: ${v.classUrl}`, ``,
    ...plainJoinES,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject: subject(v), html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: ClassLifecycleVars): RenderedEmail {
  const joinInstructionsDE = (v.audience === "student" && v.kind === "created")
    ? `${h2(`So trittst du am Tag der Stunde bei`)}
       ${p(`<strong>5 Minuten vorher</strong> gehst du in deinen Bereich und klickst auf <strong>„Zum Klassenzimmer“</strong>. Du musst nichts installieren — das Klassenzimmer öffnet sich direkt im Browser.`)}
       ${p(`Stell vorher sicher:`)}
       ${p(`• Stabile Internetverbindung<br>• Funktionierende Kamera und Mikrofon<br>• Ein ruhiger Ort während der Stunde`)}`
    : "";
  const body = `
    ${h2(`Hallo ${escapeHtml(v.recipientName)}! 👋`)}
    ${p(openerDE(v))}
    ${kvBlock([
      [v.kind === "rescheduled" ? "📅 Neuer Termin" : v.kind === "cancelled" ? "📅 War agendiert für" : "📅 Datum", escapeHtml(v.startDate)],
      ["⏱ Dauer", `${v.durationMin} Minuten`],
    ])}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(v.classUrl, ctaLabelDE(v))}
    </div>
    ${joinInstructionsDE}
    ${p(`<em style="color:#64748b;">— Aprender-Aleman.de</em>`)}
  `;
  const footerNote = v.audience === "teacher"
    ? "Du erhältst diese E-Mail, weil du der/die zugewiesene Lehrer/in bist."
    : "Du erhältst diese E-Mail, weil diese Stunde in deinem Plan ist.";
  const plainJoinDE = (v.audience === "student" && v.kind === "created")
    ? [
        `So trittst du am Tag der Stunde bei:`,
        `5 Minuten vorher gehst du in deinen Bereich und klickst auf "Zum Klassenzimmer".`,
        `Du musst nichts installieren — das Klassenzimmer öffnet sich im Browser.`,
        `Brauchst: stabile Verbindung, Kamera und Mikrofon, ruhiger Ort.`,
        ``,
      ]
    : [];
  const text = [
    `Hallo ${v.recipientName}!`, ``,
    plainOpenerDE(v),
    `Datum: ${v.startDate}`,
    `Dauer: ${v.durationMin} Min`, ``,
    `Details: ${v.classUrl}`, ``,
    ...plainJoinDE,
    `— Aprender-Aleman.de`,
  ].join("\n");
  return { subject: subject(v), html: renderEnvelope(body, footerNote), text };
}

function plainOpenerES(v: ClassLifecycleVars): string {
  const series = (v.count ?? 1) > 1;
  if (v.kind === "created")
    return v.audience === "teacher"
      ? (series ? `Nueva serie agendada: ${v.classTitle} (${v.count} clases).` : `Nueva clase agendada: ${v.classTitle}.`)
      : (series ? `Tu serie de clases está agendada: ${v.classTitle} (${v.count} sesiones).` : `Tu clase está agendada: ${v.classTitle}.`);
  if (v.kind === "rescheduled") return `Clase reprogramada: ${v.classTitle}.`;
  return `Clase cancelada: ${v.classTitle}.`;
}
function plainOpenerDE(v: ClassLifecycleVars): string {
  const series = (v.count ?? 1) > 1;
  if (v.kind === "created")
    return v.audience === "teacher"
      ? (series ? `Neue Reihe agendiert: ${v.classTitle} (${v.count} Stunden).` : `Neue Stunde agendiert: ${v.classTitle}.`)
      : (series ? `Stundenreihe agendiert: ${v.classTitle} (${v.count} Termine).` : `Stunde agendiert: ${v.classTitle}.`);
  if (v.kind === "rescheduled") return `Stunde verschoben: ${v.classTitle}.`;
  return `Stunde abgesagt: ${v.classTitle}.`;
}
