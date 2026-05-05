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

const STUDENT_ID = "79dc08ed";
const { rows: full } = await c.query(`SELECT id FROM students WHERE id::text LIKE $1 LIMIT 1`, [STUDENT_ID + "%"]);
const studentId = full[0].id;

const { rows } = await c.query(`
  SELECT
    c.id,
    c.scheduled_at,
    c.duration_minutes,
    c.actual_duration_minutes,
    c.started_at,
    c.ended_at,
    c.status,
    c.is_trial,
    c.type,
    c.title,
    c.topic,
    c.short_code,
    c.notes_admin,
    c.parent_class_id,
    c.billed_hours,
    cp.attended,
    g.name           AS group_name,
    g.class_type     AS group_class_type,
    g.level          AS group_level,
    tu.full_name     AS teacher_name,
    tu.email         AS teacher_email
   FROM class_participants cp
   JOIN classes c ON c.id = cp.class_id
   LEFT JOIN student_groups g ON g.id = c.group_id
   LEFT JOIN teachers t ON t.id = c.teacher_id
   LEFT JOIN users tu ON tu.id = t.user_id
  WHERE cp.student_id = $1
  ORDER BY c.scheduled_at ASC`, [studentId]);

console.log(`Total filas en class_participants para Nicolas: ${rows.length}`);
console.log("");

const fmt = (d) => d ? d.toISOString().slice(0,16).replace("T"," ") : "—";
const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);

for (const r of rows) {
  const dur = r.actual_duration_minutes ?? r.duration_minutes;
  console.log(
    pad(fmt(r.scheduled_at), 16) + " | " +
    pad(r.status, 9) + " | " +
    pad(`att=${r.attended ?? "—"}`, 8) + " | " +
    pad(`${dur}min`, 7) + " | " +
    pad(`bill=${r.billed_hours ?? "—"}`, 9) + " | " +
    pad(r.type ?? "?", 11) + " | " +
    pad(r.group_name ?? "(individual)", 28) + " | " +
    pad(r.teacher_name ?? "—", 22) + " | " +
    `started=${fmt(r.started_at)} ended=${fmt(r.ended_at)}` + " | " +
    `parent=${r.parent_class_id ? r.parent_class_id.slice(0,8) : "—"}` + " | " +
    `id=${r.id.slice(0,8)}` +
    (r.title ? ` | "${r.title}"` : "") +
    (r.notes_admin ? ` | notes="${r.notes_admin.slice(0,60)}"` : "")
  );
}

console.log("\n══════════ Análisis grupos del 2026-04-20 (las 5 sospechosas) ══════════");
const { rows: susp } = await c.query(`
  SELECT c.id, c.scheduled_at, c.started_at, c.ended_at, c.actual_duration_minutes, c.duration_minutes,
         c.status, c.type, c.group_id, c.title, c.topic, c.notes_admin,
         (SELECT COUNT(*) FROM class_participants WHERE class_id = c.id) AS n_participants
    FROM classes c
   WHERE c.scheduled_at::date = '2026-04-20'
     AND c.scheduled_at::time BETWEEN '19:30' AND '20:30'
   ORDER BY c.scheduled_at`);
for (const r of susp) {
  console.log(`  ${r.scheduled_at.toISOString().slice(0,16)}  type=${r.type}  status=${r.status}  participants=${r.n_participants}  group=${r.group_id?.slice(0,8) ?? "—"}  started=${fmt(r.started_at)} ended=${fmt(r.ended_at)}  actual=${r.actual_duration_minutes ?? "—"}min  notes=${r.notes_admin ?? ""}`);
}

await c.end();
