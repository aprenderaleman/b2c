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

console.log("══════════ NICOLAS — candidatos (users role=student) ══════════");
const { rows: users } = await c.query(`
  SELECT u.id, u.full_name, u.email, u.created_at,
         s.id AS student_id, s.classes_purchased, s.classes_remaining, s.current_level
    FROM users u
    LEFT JOIN students s ON s.user_id = u.id
   WHERE u.role = 'student'
     AND (LOWER(u.full_name) LIKE '%nicolas%' OR LOWER(u.full_name) LIKE '%nicolás%' OR LOWER(u.email) LIKE '%nicolas%')
   ORDER BY u.created_at DESC`);
for (const u of users) {
  console.log(`  uid=${u.id.slice(0,8)}  ${u.full_name}  ${u.email}  student=${u.student_id?.slice(0,8) ?? "—"}  pack=${u.classes_remaining}/${u.classes_purchased}  lvl=${u.current_level}`);
}

if (users.length === 0) {
  console.log("\n  (sin coincidencias en users)");
  await c.end();
  process.exit(0);
}

for (const u of users) {
  if (!u.student_id) continue;
  console.log(`\n══════════ ${u.full_name} (student=${u.student_id.slice(0,8)}) — clases asistidas ══════════`);
  const { rows: stats } = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE cp.attended = true)                AS attended_count,
      COALESCE(SUM(c.duration_minutes) FILTER (WHERE cp.attended = true), 0) AS attended_minutes,
      COUNT(*) FILTER (WHERE c.status = 'completed')            AS completed_total,
      COALESCE(SUM(c.duration_minutes) FILTER (WHERE c.status = 'completed'), 0) AS completed_minutes,
      COUNT(*) FILTER (WHERE c.is_trial = true AND c.status = 'completed') AS trial_completed,
      COUNT(*) FILTER (WHERE c.status = 'scheduled')            AS scheduled_count
    FROM class_participants cp
    JOIN classes c ON c.id = cp.class_id
   WHERE cp.student_id = $1`, [u.student_id]);
  const s = stats[0];
  console.log(`  attended=true:           ${s.attended_count} clases · ${s.attended_minutes} min  (${(s.attended_minutes/60).toFixed(2)} h)`);
  console.log(`  status=completed:        ${s.completed_total} clases · ${s.completed_minutes} min  (${(s.completed_minutes/60).toFixed(2)} h)`);
  console.log(`  · de las cuales trial:   ${s.trial_completed}`);
  console.log(`  status=scheduled (futuras): ${s.scheduled_count}`);

  const { rows: detail } = await c.query(`
    SELECT c.scheduled_at, c.duration_minutes, c.is_trial, c.status, cp.attended,
           c.short_code
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.student_id = $1
     ORDER BY c.scheduled_at ASC`, [u.student_id]);
  console.log(`\n  últimas ${detail.length} clases:`);
  for (const r of detail) {
    const d = r.scheduled_at?.toISOString?.()?.slice(0,16) ?? "?";
    console.log(`    ${d}  ${String(r.duration_minutes).padStart(3)} min  status=${r.status.padEnd(9)}  attended=${r.attended ?? "—"}  trial=${r.is_trial ? "Y" : "N"}  ${r.short_code ?? ""}`);
  }
}

await c.end();
