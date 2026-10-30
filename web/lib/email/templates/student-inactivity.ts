import { button, escapeHtml, h2, p, renderEnvelope, type RenderedEmail } from "./base";

/**
 * Emails automáticos de reactivación (Gelfis 2026-10-30), firmados por
 * Stiv, breves, con botón al chat del alumno con la academia. Tres
 * umbrales (ver lib/student-inactivity.ts):
 *   never_started_7 — 7 días desde la conversión sin primera clase
 *   inactive_14     — 14 días sin clase completada y nada agendado
 *   inactive_30     — 30 días ídem (último aviso)
 */
export type InactivityKind = "never_started_7" | "inactive_14" | "inactive_30";

export type StudentInactivityEmailVars = {
  kind:        InactivityKind;
  name:        string;            // nombre de pila
  teacherName: string | null;     // profe asignado, si lo hay
  remaining:   number | null;     // clases restantes (si > 0 se menciona)
  chatUrl:     string;            // deep-link al chat con la academia
  language:    "es" | "de";
};

export function renderStudentInactivity(v: StudentInactivityEmailVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function envelope(name: string, lead: string, chatUrl: string, cta: string, noReply: string, footer: string): string {
  const body = `
    ${h2(`Hola ${escapeHtml(name)} 👋`)}
    ${p(escapeHtml(lead))}
    <div style="text-align:center;margin:22px 0;">${button(chatUrl, cta)}</div>
    ${p(`<em style="color:#64748b;">${escapeHtml(noReply)}</em>`)}
    ${p(`Stiv · Aprender-Aleman.de`)}
  `;
  return renderEnvelope(body, footer);
}

function renderES(v: StudentInactivityEmailVars): RenderedEmail {
  const left = v.remaining && v.remaining > 0 ? ` y te quedan ${v.remaining} clases` : "";
  const withT = v.teacherName ? ` con ${v.teacherName}` : "";
  let subject: string; let lead: string;
  switch (v.kind) {
    case "never_started_7":
      subject = "¿Agendamos tu primera clase?";
      lead = `Hace una semana que estás con nosotros y aún no has tenido tu primera clase${withT}. ¿Necesitas ayuda para agendarla? Cuéntamelo por el chat y lo resolvemos hoy.`;
      break;
    case "inactive_14":
      subject = "¿Seguimos con tu alemán?";
      lead = `Llevamos dos semanas sin clase contigo${left}. ¿Ha pasado algo? Si quieres cambiar de horario, hacer una pausa o retomar, cuéntamelo por el chat y lo arreglamos.`;
      break;
    default:
      subject = "¿Seguimos con tu alemán?";
      lead = `Ya es un mes sin clase contigo${left}. No queremos que se pierdan: si prefieres una pausa, cambiar de horario o de profesor/a, o retomar ya, dímelo por el chat y lo organizamos.`;
  }
  const cta = "Responder a Stiv en el chat →";
  const noReply = "No respondas a este correo: te contesto en el chat.";
  const text = [`Hola ${v.name},`, "", lead, "", `${cta.replace(" →", "")}: ${v.chatUrl}`, "", noReply, "", "Stiv · Aprender-Aleman.de"].join("\n");
  return { subject, html: envelope(v.name, lead, v.chatUrl, cta, noReply, "Recibes este correo porque eres alumno/a de Aprender-Aleman.de."), text };
}

function renderDE(v: StudentInactivityEmailVars): RenderedEmail {
  const left = v.remaining && v.remaining > 0 ? ` und du hast noch ${v.remaining} Stunden` : "";
  const withT = v.teacherName ? ` mit ${v.teacherName}` : "";
  let subject: string; let lead: string;
  switch (v.kind) {
    case "never_started_7":
      subject = "Planen wir deine erste Stunde?";
      lead = `Du bist seit einer Woche bei uns und hattest noch keine erste Stunde${withT}. Brauchst du Hilfe beim Planen? Schreib mir im Chat und wir klären es heute.`;
      break;
    case "inactive_14":
      subject = "Machen wir mit deinem Deutsch weiter?";
      lead = `Seit zwei Wochen hatten wir keine Stunde mit dir${left}. Ist etwas passiert? Wenn du den Termin ändern, pausieren oder weitermachen möchtest, schreib mir im Chat und wir regeln es.`;
      break;
    default:
      subject = "Machen wir mit deinem Deutsch weiter?";
      lead = `Seit einem Monat hatten wir keine Stunde mit dir${left}. Wir möchten nicht, dass sie verfallen: Pause, anderer Termin oder Lehrer, oder gleich weitermachen – sag es mir im Chat und wir organisieren es.`;
  }
  const cta = "Stiv im Chat antworten →";
  const noReply = "Bitte nicht auf diese E-Mail antworten: ich antworte dir im Chat.";
  const text = [`Hallo ${v.name},`, "", lead, "", `${cta.replace(" →", "")}: ${v.chatUrl}`, "", noReply, "", "Stiv · Aprender-Aleman.de"].join("\n");
  return { subject, html: envelope(v.name, lead, v.chatUrl, cta, noReply, "Du erhältst diese E-Mail, weil du Schüler/in bei Aprender-Aleman.de bist."), text };
}
