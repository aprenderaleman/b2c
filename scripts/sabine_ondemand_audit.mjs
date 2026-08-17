#!/usr/bin/env node
/**
 * Auditar TODAS las clases de Sabine en abril que tienen bh=0 pero parecen
 * ser clases reales (on_demand, alejandro_seed, sin grupo). Calcular duración
 * real desde started_at/ended_at.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

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

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

console.log(`══════════ Clases on_demand / alejandro_seed completed con bh=0 — duración real ══════════`);
const { rows } = await db.query(`
  SELECT c.id, c.scheduled_at, c.started_at, c.ended_at,
         c.duration_minutes, c.actual_duration_minutes, c.billed_hours,
         c.notes_admin, c.title, c.type,
         (SELECT u2.full_name FROM teachers t LEFT JOIN users u2 ON u2.id=t.user_id WHERE t.id = c.teacher_id) AS teacher_name,
         (SELECT json_agg(json_build_object('name', u.full_name, 'student_id', cp.student_id))
            FROM class_participants cp JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id
           WHERE cp.class_id = c.id) AS participants,
         EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) / 60.0 AS real_minutes
    FROM classes c
    LEFT JOIN teachers t ON t.id = c.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
   WHERE c.scheduled_at >= '2026-04-01' AND c.scheduled_at < '2026-05-01'
     AND c.status = 'completed'
     AND c.billed_hours = 0
     AND c.notes_admin NOT LIKE 'zoom_uuid=%'
     AND c.notes_admin NOT LIKE 'zoom_occurrence=%'
     AND u.full_name = 'Sabine Arning'
   ORDER BY c.started_at`);

for (const c of rows) {
  const realMin = c.real_minutes ? Math.round(Number(c.real_minutes)) : null;
  const actMin  = c.actual_duration_minutes;
  const startedStr = c.started_at?.toISOString?.()?.slice(11,19) ?? "?";
  const endedStr   = c.ended_at?.toISOString?.()?.slice(11,19) ?? "?";
  const dateStr    = c.started_at?.toISOString?.()?.slice(0,10) ?? "?";
  const partsList = c.participants ? c.participants.map(p => p.name).join(", ") : "(sin participantes)";
  console.log(`  ${dateStr}  ${startedStr}→${endedStr}  real=${realMin ?? "?"}min  actual_col=${actMin ?? "null"}  notes="${c.notes_admin ?? ""}"  parts=${partsList}`);
}

console.log(`\n══════════ ¿Cuántas de esas duraron ≥15min reales? ══════════`);
const realClasses = rows.filter(c => c.real_minutes && Number(c.real_minutes) >= 15);
console.log(`  ${realClasses.length} clases con duración real ≥15min`);
const grouped = new Map();
for (const c of realClasses) {
  const partsKey = c.participants ? c.participants.map(p => p.name).join(",") : "(sin)";
  if (!grouped.has(partsKey)) grouped.set(partsKey, []);
  grouped.get(partsKey).push(c);
}
for (const [parts, list] of grouped) {
  const totalMin = list.reduce((s, c) => s + Math.round(Number(c.real_minutes)), 0);
  const totalH = list.reduce((s, c) => {
    const m = Math.round(Number(c.real_minutes));
    return s + (m < 15 ? 0 : m <= 90 ? 1 : 2);
  }, 0);
  console.log(`  - ${parts}: ${list.length} clases · ${totalMin}min real · ${totalH}h facturables`);
}

await db.end();
