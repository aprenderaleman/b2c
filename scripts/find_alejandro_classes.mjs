#!/usr/bin/env node
/**
 * Buscar el email de Alejandro (xela_cigales@hotmail.es / alejokxito@hotmail.com)
 * y variantes en participantes de TODOS los meetings de abril 2026.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const NEEDLES_EMAIL = ["xela_cigales", "alejokxito", "alejandro"];
const NEEDLES_NAME  = ["alejandro", "alejo", "sanz", "xela"];

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const { access_token: token } = await (await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
)).json();
async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

// Recolectar TODOS los meetings de la cuenta
const { users } = await zget(`/users?page_size=100`);
const allMeetings = [];
for (const u of users) {
  const { meetings = [] } = await zget(`/users/${u.id}/meetings?type=scheduled&page_size=300`);
  for (const m of meetings) allMeetings.push({ ...m, host_email: u.email });
}
console.log(`Total meetings en cuenta: ${allMeetings.length}`);

const hits = [];
for (const m of allMeetings) {
  let instances;
  try {
    const r = await zget(`/past_meetings/${m.id}/instances`);
    instances = r.meetings ?? [];
  } catch { continue; }
  const aprilInstances = instances.filter(i => (i.start_time ?? "").startsWith("2026-04"));
  if (aprilInstances.length === 0) continue;

  for (const inst of aprilInstances) {
    let det, parts;
    try {
      det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      const p = await zget(`/past_meetings/${encodeUuid(inst.uuid)}/participants?page_size=100`);
      parts = p.participants ?? [];
    } catch { continue; }

    const matchedParts = parts.filter(p => {
      const e = (p.user_email ?? "").toLowerCase();
      const n = (p.name ?? "").toLowerCase();
      return NEEDLES_EMAIL.some(s => e.includes(s)) || NEEDLES_NAME.some(s => n.includes(s));
    });
    if (matchedParts.length > 0) {
      hits.push({
        meeting_id: m.id, topic: m.topic, host: m.host_email,
        uuid: inst.uuid, start: det.start_time, duration: det.duration,
        matched: matchedParts, all: parts,
      });
    }
  }
}

console.log(`\n══════════ ${hits.length} MATCHES en abril 2026 ══════════`);
for (const h of hits) {
  console.log(`\n  meeting=${h.meeting_id} "${h.topic}"  host=${h.host}`);
  console.log(`  ${h.start}  duración=${h.duration}min  uuid=${h.uuid}`);
  console.log(`  Coincide: ${h.matched.map(p => `${p.name}<${p.user_email||"—"}> dur=${p.duration}s`).join(" | ")}`);
  console.log(`  Todos: ${h.all.map(p => `${p.name}<${p.user_email||"—"}>`).join(" | ")}`);
}

// También buscar meetings cuyo TOPIC haya cambiado y haga match con Alejandro
console.log(`\n══════════ MEETINGS con topic ALejandro ══════════`);
for (const m of allMeetings) {
  const t = (m.topic ?? "").toLowerCase();
  if (NEEDLES_NAME.some(n => t.includes(n))) {
    console.log(`  ${m.id}  "${m.topic}"  host=${m.host_email}`);
  }
}

// Mirar también si hay clases en DB de los grupos de los meetings hits
// (descubrir qué grupo asociar)
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
console.log(`\n══════════ TODAS las clases en DB de abril (status=completed o scheduled) ══════════`);
const { rows: classes } = await db.query(`
  SELECT c.id, c.scheduled_at, c.duration_minutes, c.actual_duration_minutes,
         c.billed_hours, c.status, c.title, c.notes_admin, c.type,
         c.group_id, sg.name AS group_name,
         u.full_name AS teacher_name
    FROM classes c
    LEFT JOIN student_groups sg ON sg.id = c.group_id
    LEFT JOIN teachers t ON t.id = c.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
   WHERE c.scheduled_at >= '2026-04-01' AND c.scheduled_at < '2026-05-01'
   ORDER BY c.scheduled_at`);
for (const c of classes) {
  console.log(`  ${c.scheduled_at.toISOString().slice(0,16)}  ${c.status.padEnd(10)}  bh=${c.billed_hours}  ${c.type}  profe=${c.teacher_name ?? "—"}  grupo="${c.group_name ?? "—"}"  notes="${c.notes_admin ?? ""}"`);
}
await db.end();
