#!/usr/bin/env node
/**
 * Busca en TODOS los meetings de Zoom (no solo los recurrentes principales)
 * cualquier instancia en las 4 fechas reclamadas por Sabine, donde ella
 * (coyotemoonyoga@gmail.com) Y/O Maria Eugenia (mariupp2016@gmail.com)
 * estén entre los participantes.
 */
const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tok = await (await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
)).json();
const token = tok.access_token;
async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(u) { return u.startsWith("/") || u.includes("//") ? encodeURIComponent(encodeURIComponent(u)) : encodeURIComponent(u); }

const TARGET_DATES = ["2026-04-24", "2026-04-27", "2026-04-29"];
const SABINE_EMAIL = "coyotemoonyoga@gmail.com";
const ME_EMAILS    = new Set(["mariupp2016@gmail.com", "mariupp@2016.com"]);

// Recolectar todos los meetings
const { users } = await zget(`/users?page_size=100`);
const allMeetings = [];
for (const u of users) {
  const { meetings = [] } = await zget(`/users/${u.id}/meetings?type=scheduled&page_size=300`);
  for (const m of meetings) allMeetings.push({ ...m, host_email: u.email });
}
console.log(`Buscando en ${allMeetings.length} meetings de la cuenta...\n`);

const hits = [];
for (const m of allMeetings) {
  let instances;
  try {
    const r = await zget(`/past_meetings/${m.id}/instances`);
    instances = r.meetings ?? [];
  } catch { continue; }

  for (const inst of instances) {
    const date = (inst.start_time ?? "").slice(0, 10);
    if (!TARGET_DATES.includes(date)) continue;

    let det, parts;
    try {
      det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      const p = await zget(`/past_meetings/${encodeUuid(inst.uuid)}/participants?page_size=100`);
      parts = p.participants ?? [];
    } catch { continue; }

    const sabinePresent = parts.some(p => (p.user_email||"").toLowerCase() === SABINE_EMAIL);
    const mePresent     = parts.some(p => ME_EMAILS.has((p.user_email||"").toLowerCase()));

    // Solo nos interesan instancias donde aparece Sabine O Maria Eugenia
    if (!sabinePresent && !mePresent && m.host_email !== SABINE_EMAIL) continue;

    hits.push({
      meeting: m.id, topic: m.topic, host: m.host_email,
      date, start: det.start_time, dur: det.duration,
      sabinePresent, mePresent,
      participants: parts.map(p => `${p.name||"?"}<${p.user_email||"-"}>`).join(", "),
      uuid: inst.uuid,
    });
  }
}

console.log(`══════════ ${hits.length} HITS — instancias con Sabine en las fechas ══════════\n`);
for (const h of hits) {
  console.log(`📅 ${h.date}  meeting=${h.meeting} "${h.topic}"`);
  console.log(`     ${h.start}  ${h.dur}min  Sabine=${h.sabinePresent?"✓":"✗"}  MariaEugenia=${h.mePresent?"✓":"✗"}`);
  console.log(`     Participantes: ${h.participants.slice(0,180)}`);
  console.log(`     uuid: ${h.uuid}`);
  console.log();
}
if (hits.length === 0) console.log("  (ninguna instancia con Sabine en las 4 fechas)");
