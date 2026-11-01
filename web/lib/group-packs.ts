/**
 * Dúo y Trío (Gelfis 2026-10-31): grupos de 2-3 alumnos, profesor fijo,
 * sesiones de 90 min. El profesor envía desde el CRM un enlace /g/ del
 * sitio raíz (aprender-aleman.de — backend ya en producción en el repo
 * SCHULE) que redirige al Payment Link de Stripe con el
 * client_reference_id montado. El lead paga su parte y reenvía el MISMO
 * enlace a sus compañeros; el `grp` compartido los empareja en Stripe.
 *
 * Esta lib es compartida entre el modal del profesor (client) y el
 * endpoint send-offer (server): tabla de precios €/mes/persona,
 * sesiones por nivel, generación del `grp` y plantilla del WhatsApp.
 */

export type GroupFormat  = "duo" | "trio";
export type GroupLevelId = "a1a2" | "b1" | "b2" | "c1" | "zero_to_b1";
export type GroupRitmo   = 2 | 3 | 4;

export const GROUP_FORMAT_LABELS: Record<GroupFormat, string> = {
  duo:  "Dúo",
  trio: "Trío",
};

export const GROUP_LEVELS: Array<{ id: GroupLevelId; label: string }> = [
  { id: "a1a2",       label: "A1–A2" },
  { id: "b1",         label: "B1" },
  { id: "b2",         label: "B2" },
  { id: "c1",         label: "C1" },
  { id: "zero_to_b1", label: "Fluidez (A0→B1)" },
];

/** Sesiones de 90 min totales del plan, por nivel. */
export const GROUP_SESSIONS: Record<GroupLevelId, number> = {
  a1a2: 28, b1: 42, b2: 42, c1: 52, zero_to_b1: 80,
};

/** €/mes/persona — tabla de Gelfis 2026-10-31. [formato][nivel][ritmo]. */
export const GROUP_PRICES: Record<GroupFormat, Record<GroupLevelId, Record<GroupRitmo, number>>> = {
  duo: {
    a1a2:       { 2: 290, 3: 430, 4: 555 },
    b1:         { 2: 280, 3: 460, 4: 550 },
    b2:         { 2: 280, 3: 460, 4: 550 },
    c1:         { 2: 320, 3: 480, 4: 630 },
    zero_to_b1: { 2: 310, 3: 460, 4: 660 },
  },
  trio: {
    a1a2:       { 2: 240, 3: 350, 4: 450 },
    b1:         { 2: 230, 3: 370, 4: 450 },
    b2:         { 2: 230, 3: 370, 4: 450 },
    c1:         { 2: 260, 3: 390, 4: 510 },
    zero_to_b1: { 2: 250, 3: 375, 4: 540 },
  },
};

const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * `grp` único del grupo: <prefijo del leadId>-<mes><año2>, p. ej.
 * "5a062983-nov26". Autogenerado — el profesor nunca lo escribe. Si el
 * mismo lead vuelve otro mes con otros amigos, el grp cambia solo.
 */
export function buildGroupGrp(leadId: string, now = new Date()): string {
  const prefix = leadId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8);
  return `${prefix}-${MONTH_ABBR[now.getMonth()]}${String(now.getFullYear()).slice(2)}`.toLowerCase();
}

/** URL pública /g/ del sitio raíz (el 302 a Stripe vive en el repo SCHULE). */
export function buildGroupUrl(format: GroupFormat, lvl: GroupLevelId, r: GroupRitmo, leadId: string): string {
  const grp = buildGroupGrp(leadId);
  return `https://aprender-aleman.de/g/${format}?lvl=${lvl}&r=${r}&grp=${grp}&lead=${leadId}`;
}

/**
 * Plantilla del WhatsApp (reglas de copy Gelfis 2026-10-31): nunca
 * nombres de los compañeros (aún no los tenemos), nunca el total del
 * plan (solo €/mes/persona; el total está en el checkout de Stripe).
 */
export function renderGroupOfferMessage(opts: {
  leadName: string;
  format: GroupFormat;
  lvl: GroupLevelId;
  r: GroupRitmo;
  url: string;
}): string {
  const { leadName, format, lvl, r, url } = opts;
  const nivel = GROUP_LEVELS.find(l => l.id === lvl)!.label;
  const price = GROUP_PRICES[format][lvl][r];
  const sessions = GROUP_SESSIONS[lvl];
  const companions = format === "duo" ? "tu pareja o compañero/a" : "tus compañeros/as";
  const firstName = leadName.trim().split(/\s+/)[0] || leadName;

  return [
    `Hola ${firstName} 👋`,
    `Aquí tu enlace para inscribirte en ${GROUP_FORMAT_LABELS[format]} ${nivel} a ritmo ${r}/sem:`,
    ``,
    url,
    ``,
    `✅ ${price} €/mes/persona · ${sessions} sesiones de 90 min`,
    `✅ Al terminar vuestro plan la suscripción se cierra sola`,
    `✅ Cada uno con su Garantía de Nivel por escrito`,
    `✅ Sin permanencia, cancela cuando quieras`,
    ``,
    `👉 Paga tu parte y REENVÍA ESTE MISMO ENLACE a ${companions} para que paguen la suya. Quedáis emparejados automáticamente.`,
  ].join("\n");
}
