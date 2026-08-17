#!/usr/bin/env node
/**
 * Busca clases potencialmente duplicadas en abril 2026:
 *   - Mismo profesor + mismo alumno + mismo día.
 * Lista las parejas para revisión manual.
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
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

console.log("══════════ CLASES INDIVIDUALES — mismo profe + mismo alumno + mismo día ══════════\n");

// Para clases individuales (1 alumno por clase), buscar duplicados por (teacher, student, date)
const r1 = await c.query(`
  WITH classes_with_student AS (
    SELECT
      cls.id              AS class_id,
      cls.scheduled_at::date AS date,
      cls.scheduled_at,
      cls.started_at,
      cls.duration_minutes,
      cls.actual_duration_minutes,
      cls.billed_hours,
      cls.title,
      cls.notes_admin,
      tu.full_name        AS teacher_name,
      su.full_name        AS student_name,
      cls.teacher_id,
      cp.student_id
    FROM classes cls
    JOIN teachers t ON t.id = cls.teacher_id
    JOIN users tu  ON tu.id = t.user_id
    JOIN class_participants cp ON cp.class_id = cls.id
    JOIN students s ON s.id = cp.student_id
    JOIN users su  ON su.id = s.user_id
    WHERE cls.scheduled_at >= '2026-04-01' AND cls.scheduled_at < '2026-05-01'
      AND cls.status = 'completed'
      AND cls.billed_hours > 0
      AND cls.type = 'individual'
  )
  SELECT
    teacher_name, student_name, date,
    COUNT(*)::int          AS n_classes,
    SUM(billed_hours)::int  AS total_billed_hours,
    array_agg(class_id::text ORDER BY scheduled_at) AS class_ids,
    array_agg(scheduled_at::text || ' (' || duration_minutes || 'min, bh=' || billed_hours || ', "' || COALESCE(title, '') || '")'
              ORDER BY scheduled_at) AS detail
  FROM classes_with_student
  GROUP BY teacher_name, student_name, date
  HAVING COUNT(*) > 1
  ORDER BY teacher_name, student_name, date
`);

if (r1.rows.length === 0) {
  console.log("  (sin duplicados)");
} else {
  for (const row of r1.rows) {
    console.log(`⚠ ${row.teacher_name} con ${row.student_name} — ${row.date.toISOString().slice(0,10)}: ${row.n_classes} clases (total ${row.total_billed_hours}h)`);
    for (const d of row.detail) console.log(`    · ${d}`);
    console.log();
  }
}

console.log("\n══════════ CLASES GRUPALES — mismo profe + mismo grupo + mismo día ══════════\n");
const r2 = await c.query(`
  SELECT
    tu.full_name        AS teacher_name,
    sg.name             AS group_name,
    cls.scheduled_at::date AS date,
    COUNT(*)::int       AS n_classes,
    SUM(cls.billed_hours)::int AS total_billed_hours,
    array_agg(cls.scheduled_at::text || ' (' || cls.duration_minutes || 'min, bh=' || cls.billed_hours || ')' ORDER BY cls.scheduled_at) AS detail
  FROM classes cls
  JOIN teachers t ON t.id = cls.teacher_id
  JOIN users tu   ON tu.id = t.user_id
  JOIN student_groups sg ON sg.id = cls.group_id
  WHERE cls.scheduled_at >= '2026-04-01' AND cls.scheduled_at < '2026-05-01'
    AND cls.status = 'completed'
    AND cls.billed_hours > 0
    AND cls.type = 'group'
  GROUP BY tu.full_name, sg.name, cls.scheduled_at::date
  HAVING COUNT(*) > 1
  ORDER BY tu.full_name, sg.name, cls.scheduled_at::date
`);
if (r2.rows.length === 0) {
  console.log("  (sin duplicados)");
} else {
  for (const row of r2.rows) {
    console.log(`⚠ ${row.teacher_name} en "${row.group_name}" — ${row.date.toISOString().slice(0,10)}: ${row.n_classes} clases (total ${row.total_billed_hours}h)`);
    for (const d of row.detail) console.log(`    · ${d}`);
    console.log();
  }
}

await c.end();
