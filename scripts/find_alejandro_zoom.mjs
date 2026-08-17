#!/usr/bin/env node
/**
 * Buscar el meeting de Zoom de Alejandro:
 *  1. Listar TODOS los meetings de la cuenta Zoom (recurrentes + no recurrentes).
 *  2. Filtrar los que tengan "alejandro", "alejo" o "sanz" en el topic.
 *  3. Mostrar instancias pasadas + duración + asistentes para abril 2026.
 *  4. Cruzar con el grupo de Alejandro en DB.
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

// 1. Listar todos los users de la cuenta Zoom y sus meetings.
console.log("══════════ 1. USUARIOS DE LA CUENTA ZOOM ══════════");
const { users } = await zget(`/users?page_size=100`);
for (const u of users) {
  console.log(`  ${u.id}  ${u.email.padEnd(36)}  ${u.first_name} ${u.last_name}`);
}

console.log("\n══════════ 2. MEETINGS POR USUARIO (todos) ══════════");
const allMeetings = [];
for (const u of users) {
  const { meetings = [] } = await zget(`/users/${u.id}/meetings?type=scheduled&page_size=300`);
  console.log(`\n  ── ${u.email}: ${meetings.length} meetings`);
  for (const m of meetings) {
    allMeetings.push({ ...m, host_email: u.email });
    console.log(`     ${m.id}  "${m.topic}"  type=${m.type}`);
  }
  // También los no-recurrentes pasados
  try {
    const { meetings: pastM = [] } = await zget(`/users/${u.id}/meetings?type=previous_meetings&page_size=300`);
    for (const m of pastM) {
      if (allMeetings.find(x => x.id === m.id)) continue;
      allMeetings.push({ ...m, host_email: u.email });
      console.log(`     ${m.id}  "${m.topic}"  (past, type=${m.type})`);
    }
  } catch {}
}

// 3. Filtrar los relacionados con Alejandro
console.log("\n══════════ 3. CANDIDATOS RELACIONADOS CON ALEJANDRO ══════════");
const candidates = allMeetings.filter(m =>
  /alejandr|alejo|sanz|xela/i.test(m.topic ?? ""));
for (const m of candidates) {
  console.log(`  zoom_id=${m.id}  host=${m.host_email}  topic="${m.topic}"`);
}

// 4. Para cada candidato, instancias pasadas en abril 2026
console.log("\n══════════ 4. INSTANCIAS PASADAS DE ABRIL 2026 ══════════");
for (const m of candidates) {
  console.log(`\n── meeting ${m.id} "${m.topic}" ──`);
  let instances;
  try {
    const r = await zget(`/past_meetings/${m.id}/instances`);
    instances = r.meetings ?? [];
  } catch (e) {
    console.log(`  ✗ no past instances: ${e.message}`);
    continue;
  }
  const aprilInstances = instances.filter(i => (i.start_time ?? "").startsWith("2026-04"));
  console.log(`  total past=${instances.length}, abril=${aprilInstances.length}`);
  for (const inst of aprilInstances) {
    let det, parts;
    try {
      det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      const p = await zget(`/past_meetings/${encodeUuid(inst.uuid)}/participants?page_size=100`);
      parts = p.participants ?? [];
    } catch (e) {
      console.log(`  ✗ ${inst.start_time}: ${e.message}`);
      continue;
    }
    const who = parts.map(p => `${p.name}<${p.user_email||"—"}>`).join(", ");
    console.log(`  ${det.start_time}  ${det.duration}min  uuid=${inst.uuid}`);
    console.log(`     asistentes: ${who}`);
  }
  // También clases de marzo para contexto
  const marchInstances = instances.filter(i => (i.start_time ?? "").startsWith("2026-03"));
  if (marchInstances.length > 0) {
    console.log(`  --- marzo (contexto): ${marchInstances.length} instancias ---`);
    for (const inst of marchInstances) {
      const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      console.log(`  ${det.start_time}  ${det.duration}min`);
    }
  }
}

// 5. Mirar el grupo de Alejandro en DB
console.log("\n══════════ 5. GRUPO DE ALEJANDRO EN DB ══════════");
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: groups } = await db.query(`
  SELECT id, name, class_type, meet_link, document_url, teacher_id, active
    FROM student_groups
   WHERE name ILIKE '%alejandr%' OR name ILIKE '%sanz%'`);
for (const g of groups) {
  console.log(`  group_id=${g.id}  name="${g.name}"  type=${g.class_type}  active=${g.active}`);
  console.log(`     meet_link=${g.meet_link ?? "(null)"}`);
}
await db.end();
