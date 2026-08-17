#!/usr/bin/env node
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

const { rows } = await db.query(`
  SELECT c.id, c.scheduled_at, c.started_at, c.ended_at,
         c.duration_minutes, c.actual_duration_minutes, c.billed_hours,
         c.status, c.type, c.title, c.notes_admin,
         sg.name AS group_name,
         (SELECT json_agg(json_build_object('name', u2.full_name) ORDER BY u2.full_name)
            FROM class_participants cp
            JOIN students s ON s.id = cp.student_id
            JOIN users u2 ON u2.id = s.user_id
           WHERE cp.class_id = c.id) AS participants,
         chl.amount_cents
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    LEFT JOIN student_groups sg ON sg.id = c.group_id
    LEFT JOIN class_hours_log chl ON chl.class_id = c.id
   WHERE u.full_name = 'Florian Zormann'
     AND c.status = 'completed'
   ORDER BY COALESCE(c.started_at, c.scheduled_at) DESC
   LIMIT 3`);

console.log(`Últimas 3 clases completadas de Florian Zormann:\n`);
for (const r of rows) {
  const when = (r.started_at ?? r.scheduled_at).toISOString().slice(0,16).replace("T", " ");
  const dur  = r.actual_duration_minutes ?? r.duration_minutes;
  const parts = r.participants ? r.participants.map(p => p.name).join(", ") : "—";
  const pay  = r.amount_cents ? `${r.amount_cents/100}€` : "(sin class_hours_log)";
  console.log(`  ${when}  ${r.type.padEnd(10)}  ${dur}min  bh=${r.billed_hours}h  → ${pay}`);
  console.log(`     "${r.title}"  grupo: ${r.group_name ?? "—"}`);
  console.log(`     alumnos: ${parts}`);
  console.log(`     id=${r.id}  notes="${r.notes_admin ?? ""}"`);
  console.log();
}

await db.end();
