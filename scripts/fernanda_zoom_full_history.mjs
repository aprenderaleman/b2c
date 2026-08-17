#!/usr/bin/env node
/**
 * READ-ONLY: lista TODAS las instancias pasadas del meeting recurrente
 * "Fernanda VIP" en Zoom (id 85833907996, host Florian) y cruza contra
 * lo que tenemos en DB. El objetivo: detectar clases que existen en
 * Zoom pero NO en DB (= clases pre-plataforma sin importar).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";
const MEETING_ID    = "85833907996";       // Fernanda VIP

const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const FERNANDA_ID = "8d4274af-7f8c-4d57-a304-54c5a03aa14a";

// 1. Token Zoom
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
const { access_token: token } = await tokRes.json();

function encUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}
async function zget(path) {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r.json();
}

// 2. List instances
const list = await zget(`/past_meetings/${MEETING_ID}/instances`);
console.log(`Past instances de Fernanda VIP (${MEETING_ID}): ${list.meetings.length}\n`);

// 3. Para cada instancia, traer detalles (start_time real + duración)
const all = [];
for (const inst of list.meetings) {
  try {
    const det = await zget(`/past_meetings/${encUuid(inst.uuid)}`);
    all.push({
      start: det.start_time,
      end:   det.end_time,
      durationMin: det.duration,
      participantsCount: det.participants_count,
      uuid: inst.uuid,
    });
  } catch (e) {
    console.error(`  ✗ details for ${inst.uuid}: ${e.message?.slice(0,80)}`);
  }
}
all.sort((a,b) => a.start.localeCompare(b.start));

// 4. DB: lo que ya está registrado para Fernanda (todas, no solo completed)
const db = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const dbRows = await db.query(`
  SELECT cls.scheduled_at, cls.status, cls.duration_minutes, cls.actual_duration_minutes, cls.billed_hours
    FROM classes cls JOIN class_participants cp ON cp.class_id=cls.id
   WHERE cp.student_id = $1
   ORDER BY cls.scheduled_at`, [FERNANDA_ID]);
const dbStarts = new Set(dbRows.rows.map(r => r.scheduled_at.toISOString().slice(0,16)));

// 5. Cruzar
console.log(`Total Zoom: ${all.length} · Total DB (Fernanda): ${dbRows.rows.length}\n`);
console.log(`══════════ INSTANCIAS ZOOM vs DB ══════════`);
console.log(`Fecha           Zoom_dur  DB?   Notas`);
let zoomOnly = 0, both = 0, zoomShort = 0;
for (const z of all) {
  const k = z.start.slice(0,16);
  const inDb = dbStarts.has(k);
  // También probar ±5min porque Zoom y DB no siempre coinciden al minuto.
  let nearMatch = inDb;
  if (!nearMatch) {
    const zMs = new Date(z.start).getTime();
    nearMatch = dbRows.rows.some(r => Math.abs(r.scheduled_at.getTime() - zMs) < 10 * 60_000);
  }
  if (nearMatch) both++; else zoomOnly++;
  const flag = z.durationMin < 15 ? "(<15min, no factura)" : "";
  if (z.durationMin < 15) zoomShort++;
  console.log(`  ${z.start.slice(0,16)}  ${String(z.durationMin).padStart(3)}min   ${nearMatch?'✓':'✗ ZOOM-ONLY'}   ${flag}`);
}

console.log(`\n══════════ RESUMEN ══════════`);
console.log(`  En Zoom Y en DB:        ${both}`);
console.log(`  Solo en Zoom (faltan):  ${zoomOnly}`);
console.log(`  Zoom <15min (no contar): ${zoomShort}`);
console.log(`  En DB total Fernanda:    ${dbRows.rows.length}`);
console.log(`  En DB completed:         ${dbRows.rows.filter(r => r.status === 'completed').length}`);

await db.end();
