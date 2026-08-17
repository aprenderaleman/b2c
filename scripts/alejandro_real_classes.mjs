#!/usr/bin/env node
/**
 * Listar TODAS las clases (Zoom + LiveKit) en las que aparece Alejandro
 * como participante, con sus duraciones reales.
 *
 * También: con la regla nueva <15min=0h, recalcular cuántas horas le tocan
 * a Sabine si esas clases bh=0 deberían pasar a bh=1.
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

function newRule(min) { if (min < 15) return 0; if (min <= 90) return 1; return 2; }

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

// 1. Ubicar Alejandro
const { rows: [alej] } = await db.query(`
  SELECT s.id, u.full_name, u.email
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.full_name = 'Alejandro' AND u.role = 'student'
   LIMIT 1`);
console.log(`Alejandro: student_id=${alej.id}  email=${alej.email}\n`);

// 2. TODAS sus class_participants (sin filtro de mes)
const { rows: parts } = await db.query(`
  SELECT cp.attended, cp.counts_as_session, cp.minutes_attended,
         c.id AS class_id, c.scheduled_at, c.started_at, c.ended_at,
         c.duration_minutes, c.actual_duration_minutes, c.billed_hours,
         c.status, c.title, c.notes_admin, c.type,
         (SELECT u.full_name FROM teachers t LEFT JOIN users u ON u.id=t.user_id WHERE t.id = c.teacher_id) AS teacher_name
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1
   ORDER BY c.scheduled_at`, [alej.id]);

console.log(`══════════ ${parts.length} class_participants de Alejandro (TODOS los meses) ══════════`);
let recountable = 0;  // clases con duración >= 15min pero bh=0
for (const p of parts) {
  const date = p.started_at?.toISOString?.()?.slice(0,16) ?? p.scheduled_at?.toISOString?.()?.slice(0,16);
  const ad = p.actual_duration_minutes;
  const dur = p.duration_minutes;
  const realMin = ad ?? dur ?? 0;
  const newBh = newRule(realMin);
  const flag = (p.billed_hours === 0 && newBh > 0 && p.status === "completed") ? "  ⚠ debería ser bh=" + newBh : "";
  if (flag) recountable++;
  console.log(`  ${date}  ${p.status.padEnd(10)}  ${p.type.padEnd(10)}  bh=${p.billed_hours}  actual=${ad ?? "?"}min  dur=${dur}min  profe=${p.teacher_name}  notes="${p.notes_admin ?? ""}"${flag}`);
}

console.log(`\n  ${recountable} clases completed con duración real ≥15min pero bh=0 → reclamables con la regla nueva.`);

// 3. Buscar clases de Sabine completed con bh=0 en abril donde Alejandro PODRÍA estar (sin grupo o grupo Alejandro)
console.log(`\n══════════ Clases on_demand y "Alejandro Sanz" de Sabine en abril (independiente de class_participants) ══════════`);
const { rows: candidates } = await db.query(`
  SELECT c.id, c.scheduled_at, c.started_at, c.ended_at,
         c.duration_minutes, c.actual_duration_minutes, c.billed_hours,
         c.status, c.title, c.notes_admin, c.type,
         sg.name AS group_name,
         (SELECT COUNT(*) FROM class_participants cp WHERE cp.class_id = c.id) AS participant_count,
         (SELECT json_agg(json_build_object('student_id', cp.student_id, 'name', u.full_name))
            FROM class_participants cp JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id
           WHERE cp.class_id = c.id) AS participants
    FROM classes c
    LEFT JOIN student_groups sg ON sg.id = c.group_id
    LEFT JOIN teachers t ON t.id = c.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
   WHERE c.scheduled_at >= '2026-04-01' AND c.scheduled_at < '2026-05-01'
     AND u.full_name = 'Sabine Arning'
     AND c.status = 'completed'
     AND c.billed_hours = 0
     AND c.notes_admin NOT LIKE 'zoom_uuid=%'
   ORDER BY c.scheduled_at`);
for (const c of candidates) {
  const realMin = c.actual_duration_minutes ?? c.duration_minutes ?? 0;
  const newBh = newRule(realMin);
  const partsList = c.participants ? c.participants.map(p => p.name).join(", ") : "(sin participantes)";
  console.log(`  ${c.started_at?.toISOString?.()?.slice(0,16) ?? c.scheduled_at.toISOString().slice(0,16)}  ${c.type.padEnd(10)}  actual=${realMin}min  bh=${c.billed_hours}→${newBh}  notes="${c.notes_admin ?? ""}"  parts=${partsList}`);
}

// 4. Ver el grupo "Alejandro Sanz" — sus miembros oficiales
console.log(`\n══════════ Miembros oficiales del grupo Alejandro Sanz ══════════`);
const { rows: members } = await db.query(`
  SELECT s.id, u.full_name, u.email
    FROM student_group_members m
    JOIN students s ON s.id = m.student_id
    JOIN users u ON u.id = s.user_id
   WHERE m.group_id = (SELECT id FROM student_groups WHERE name = 'Alejandro Sanz - Deutsch B1 I Aprender-Aleman.de')`);
for (const m of members) console.log(`  ${m.full_name}  ${m.email}  (student_id=${m.id})`);

await db.end();
