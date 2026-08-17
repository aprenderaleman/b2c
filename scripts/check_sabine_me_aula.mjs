#!/usr/bin/env node
/**
 * Buscar TODAS las clases de Sabine en abril donde Maria Eugenia aparezca
 * como participante — incluyendo aula LiveKit, no solo Zoom.
 * Foco: 24 y 29 de abril.
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

console.log("══════════ TODAS las clases de Sabine 24/29-abr (cualquier fuente) ══════════\n");

const { rows: classes } = await c.query(`
  SELECT
    cls.id, cls.scheduled_at, cls.started_at, cls.ended_at,
    cls.duration_minutes, cls.actual_duration_minutes, cls.billed_hours,
    cls.status, cls.title, cls.notes_admin, cls.type,
    EXTRACT(EPOCH FROM (cls.ended_at - cls.started_at)) / 60.0 AS real_min,
    (SELECT json_agg(json_build_object(
        'name', u2.full_name,
        'email', u2.email
      )) FROM class_participants cp
      JOIN students s ON s.id = cp.student_id
      JOIN users u2 ON u2.id = s.user_id
      WHERE cp.class_id = cls.id) AS participants
  FROM classes cls
  JOIN teachers t ON t.id = cls.teacher_id
  JOIN users u ON u.id = t.user_id
  WHERE u.full_name = 'Sabine Arning'
    AND cls.scheduled_at::date IN ('2026-04-24', '2026-04-29')
  ORDER BY cls.scheduled_at`);

if (classes.length === 0) {
  console.log("  (NO hay ninguna clase de Sabine en esas 2 fechas en DB)");
} else {
  for (const cl of classes) {
    const d = cl.scheduled_at.toISOString().slice(0, 16);
    const realMin = cl.real_min ? Math.round(Number(cl.real_min)) : null;
    console.log(`  ${d}  status=${cl.status}  bh=${cl.billed_hours}  ${cl.type}`);
    console.log(`    title: "${cl.title}"`);
    console.log(`    notes: "${cl.notes_admin ?? ""}"`);
    console.log(`    actual_dur=${cl.actual_duration_minutes}min  real(end-start)=${realMin}min`);
    if (cl.participants && cl.participants.length > 0) {
      console.log(`    participantes: ${cl.participants.map(p => p.name + (p.email ? ` <${p.email}>` : "")).join(", ")}`);
    } else {
      console.log(`    participantes: (sin participantes registrados)`);
    }
    console.log();
  }
}

console.log("\n══════════ Maria Eugenia EN CUALQUIER class_participants 24/29-abr ══════════\n");
const { rows: meParts } = await c.query(`
  SELECT
    cls.scheduled_at, cls.id, cls.title, cls.status, cls.billed_hours,
    cls.notes_admin,
    (SELECT u.full_name FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.id = cls.teacher_id) AS teacher_name
  FROM class_participants cp
  JOIN students s ON s.id = cp.student_id
  JOIN users u ON u.id = s.user_id
  JOIN classes cls ON cls.id = cp.class_id
  WHERE u.full_name = 'Maria Eugenia'
    AND cls.scheduled_at::date IN ('2026-04-24', '2026-04-29')
  ORDER BY cls.scheduled_at`);

if (meParts.length === 0) {
  console.log("  (Maria Eugenia NO aparece en ninguna clase del 24 o 29 de abril)");
} else {
  for (const r of meParts) {
    console.log(`  ${r.scheduled_at.toISOString().slice(0,16)}  ${r.status}  bh=${r.billed_hours}  profe=${r.teacher_name}`);
    console.log(`    title: "${r.title}"`);
    console.log(`    notes: "${r.notes_admin ?? ""}"`);
  }
}

console.log("\n══════════ Sesiones LiveKit (aula) en abril que tocan Sabine ══════════\n");
// Buscar todas las clases on_demand o creadas en aula que tengan Sabine
const { rows: aulaClasses } = await c.query(`
  SELECT cls.scheduled_at, cls.started_at, cls.ended_at, cls.title,
         cls.duration_minutes, cls.actual_duration_minutes, cls.billed_hours, cls.status,
         cls.notes_admin
  FROM classes cls
  JOIN teachers t ON t.id = cls.teacher_id
  JOIN users u ON u.id = t.user_id
  WHERE u.full_name = 'Sabine Arning'
    AND cls.scheduled_at >= '2026-04-22' AND cls.scheduled_at < '2026-05-01'
    AND (cls.notes_admin IS NULL
         OR cls.notes_admin NOT LIKE 'zoom_uuid=%'
         OR cls.notes_admin = 'on_demand'
         OR cls.notes_admin LIKE '%alejandro_seed%'
         OR cls.notes_admin = '')
  ORDER BY cls.scheduled_at`);
for (const r of aulaClasses) {
  console.log(`  ${r.scheduled_at?.toISOString?.()?.slice(0,16)}  ${r.status}  bh=${r.billed_hours}  notes="${r.notes_admin?.slice(0,60) ?? ""}"  "${r.title}"`);
}
if (aulaClasses.length === 0) console.log("  (ninguna)");

await c.end();
