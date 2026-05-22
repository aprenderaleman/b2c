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

console.log("══════════ MARINA — users ══════════");
const u = await c.query(`SELECT id, full_name, email, role, active FROM users WHERE full_name ILIKE '%marina%' OR email ILIKE '%marina%'`);
console.table(u.rows);

if (!u.rows.length) { await c.end(); process.exit(0); }
const marina = u.rows.find(r => r.full_name?.toLowerCase().includes("velero")) || u.rows[0];
const uid = marina.id;
console.log("Marina user_id:", uid);

const st = await c.query(`SELECT * FROM students WHERE user_id=$1`, [uid]);
console.log("══════════ students row ══════════");
console.log(st.rows);
const sid = st.rows[0]?.id;

console.log("══════════ group memberships ══════════");
const gm = await c.query(`
  SELECT gm.*, g.name AS group_name, g.teacher_id, g.active AS group_active,
         t.user_id AS teacher_user_id, tu.full_name AS teacher_name
  FROM student_group_members gm
  JOIN student_groups g ON g.id = gm.group_id
  LEFT JOIN teachers t ON t.id = g.teacher_id
  LEFT JOIN users tu ON tu.id = t.user_id
  WHERE gm.student_id = $1
`, [sid]);
console.table(gm.rows);

console.log("══════════ direct classes (student_id) ══════════");
const dc = await c.query(`
  SELECT id, scheduled_at, status, type, teacher_id, group_id, student_id
  FROM classes WHERE student_id=$1 AND scheduled_at >= NOW() - INTERVAL '2 days'
  ORDER BY scheduled_at LIMIT 20
`, [sid]);
console.table(dc.rows);

for (const g of gm.rows) {
  console.log(`══════════ classes for group ${g.group_name} (${g.group_id}) ══════════`);
  const gc = await c.query(`
    SELECT id, scheduled_at, status, type, teacher_id, group_id, student_id
    FROM classes WHERE group_id=$1 AND scheduled_at >= NOW() - INTERVAL '2 days'
    ORDER BY scheduled_at LIMIT 20
  `, [g.group_id]);
  console.table(gc.rows);
}

await c.end();
