import { button, escapeHtml, h2, kvBlock, p, renderEnvelope, type RenderedEmail } from "./base";

export type TrialAssignedTeacherVars = {
  teacherFirstName: string;
  leadName:         string;
  startDate:        string;   // pre-formatted "viernes 27 de junio, 15:00 (Berlín)"
  durationMin:      number;
  germanLevel:      string | null;
  goal:             string | null;
  language:         "es" | "de";
};

export function renderTrialAssignedTeacher(v: TrialAssignedTeacherVars): RenderedEmail {
  return v.language === "de" ? renderDE(v) : renderES(v);
}

function renderES(v: TrialAssignedTeacherVars): RenderedEmail {
  const subject = `Nueva clase de prueba — ${v.startDate}`;
  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const kvRows: Array<[string, string]> = [
    ["📅 Fecha", escapeHtml(v.startDate)],
    ["⏱ Duración", `${v.durationMin} minutos`],
    ["👤 Lead", escapeHtml(v.leadName)],
  ];
  if (v.germanLevel) kvRows.push(["📊 Nivel", escapeHtml(v.germanLevel)]);
  if (v.goal) kvRows.push(["🎯 Objetivo", escapeHtml(v.goal)]);

  const body = `
    ${h2(`¡Hola ${escapeHtml(v.teacherFirstName)}!`)}
    ${p(`Se te ha asignado una <strong>nueva clase de prueba</strong>:`)}
    ${kvBlock(kvRows)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(`${platformUrl}/profesor/clasedeprueba`, "Ver mis clases de prueba →")}
    </div>
    ${p(`<em style="color:#64748b;">Entra a la plataforma para ver todos los detalles del lead y preparar la clase.</em>`)}
  `;
  const footerNote =
    "Recibes este correo porque tienes las clases de prueba habilitadas en Aprender-Aleman.de.";
  const text = [
    `¡Hola ${v.teacherFirstName}!`, ``,
    `Se te ha asignado una nueva clase de prueba:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} min`,
    `👤 Lead: ${v.leadName}`,
    ...(v.germanLevel ? [`📊 Nivel: ${v.germanLevel}`] : []),
    ...(v.goal ? [`🎯 Objetivo: ${v.goal}`] : []),
    ``,
    `Ver detalles: ${platformUrl}/profesor/clasedeprueba`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}

function renderDE(v: TrialAssignedTeacherVars): RenderedEmail {
  const subject = `Neue Probestunde — ${v.startDate}`;
  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const kvRows: Array<[string, string]> = [
    ["📅 Datum", escapeHtml(v.startDate)],
    ["⏱ Dauer", `${v.durationMin} Minuten`],
    ["👤 Lead", escapeHtml(v.leadName)],
  ];
  if (v.germanLevel) kvRows.push(["📊 Niveau", escapeHtml(v.germanLevel)]);
  if (v.goal) kvRows.push(["🎯 Ziel", escapeHtml(v.goal)]);

  const body = `
    ${h2(`Hallo ${escapeHtml(v.teacherFirstName)}!`)}
    ${p(`Dir wurde eine <strong>neue Probestunde</strong> zugewiesen:`)}
    ${kvBlock(kvRows)}
    <div style="text-align:center;margin:24px 0 8px 0;">
      ${button(`${platformUrl}/profesor/clasedeprueba`, "Meine Probestunden anzeigen →")}
    </div>
    ${p(`<em style="color:#64748b;">Melde dich auf der Plattform an, um alle Details zum Lead zu sehen und dich vorzubereiten.</em>`)}
  `;
  const footerNote =
    "Du erhältst diese E-Mail, weil du Probestunden auf Aprender-Aleman.de aktiviert hast.";
  const text = [
    `Hallo ${v.teacherFirstName}!`, ``,
    `Dir wurde eine neue Probestunde zugewiesen:`,
    `📅 ${v.startDate}`,
    `⏱ ${v.durationMin} Min`,
    `👤 Lead: ${v.leadName}`,
    ...(v.germanLevel ? [`📊 Niveau: ${v.germanLevel}`] : []),
    ...(v.goal ? [`🎯 Ziel: ${v.goal}`] : []),
    ``,
    `Details anzeigen: ${platformUrl}/profesor/clasedeprueba`,
  ].join("\n");
  return { subject, html: renderEnvelope(body, footerNote), text };
}
