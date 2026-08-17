#!/usr/bin/env node
/**
 * Verifica las 4 fechas que Sabine reclama:
 *   - 27-abr / 29-abr grupo Morgens
 *   - 24-abr / 29-abr Maria Eugenia VIP
 *
 * Para cada fecha:
 *   1. Verifica si hay instancia en Zoom
 *   2. Verifica si está en DB
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await (await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
)).json();
const token = tokRes.access_token;
async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(u) { return u.startsWith("/") || u.includes("//") ? encodeURIComponent(encodeURIComponent(u)) : encodeURIComponent(u); }

const TARGETS = [
  { meeting: "81635585039", label: "Morgens (grupo)",   dates: ["2026-04-27", "2026-04-29"] },
  { meeting: "81802815059", label: "Maria Eugenia VIP", dates: ["2026-04-24", "2026-04-29"] },
];

const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

for (const t of TARGETS) {
  console.log(`\n══════════ ${t.label} (zoom ${t.meeting}) ══════════`);
  const { meetings: instances = [] } = await zget(`/past_meetings/${t.meeting}/instances`);
  for (const date of t.dates) {
    const matching = instances.filter(i => (i.start_time??"").startsWith(date));
    console.log(`\n  📅 ${date}: ${matching.length} instancia(s) en Zoom`);
    for (const inst of matching) {
      const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      const mins = det.duration ?? 0;
      const bh   = mins < 15 ? 0 : mins <= 90 ? 1 : 2;
      console.log(`     · ${inst.start_time}  ${mins}min → bh=${bh}h  uuid=${inst.uuid}`);

      // ¿Ya está en DB?
      const dbR = await c.query(
        `SELECT id, billed_hours, scheduled_at FROM classes WHERE notes_admin = $1`,
        [`zoom_uuid=${inst.uuid}`],
      );
      if (dbR.rowCount > 0) {
        console.log(`        ✓ EN DB: ${dbR.rows[0].id} bh=${dbR.rows[0].billed_hours}`);
      } else {
        console.log(`        ⚠ FALTA EN DB`);
      }
    }
  }
}

await c.end();
