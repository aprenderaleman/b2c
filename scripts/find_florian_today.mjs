import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query(`
  SELECT c.id, to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','Dy YYYY-MM-DD HH24:MI') AS berlin,
         c.status, g.name AS grupo,
         (SELECT array_agg(u.full_name) FROM class_participants cp JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id WHERE cp.class_id=c.id) AS alumnos
    FROM classes c LEFT JOIN student_groups g ON g.id=c.group_id
   WHERE c.teacher_id='544a84e9-7cc6-4f32-a342-21a5c14a137b'
     AND c.status='scheduled'
     AND (c.scheduled_at AT TIME ZONE 'Europe/Berlin')::date = '2026-05-06'
   ORDER BY c.scheduled_at`);
console.log("Total:", r.rows.length);
for (const x of r.rows) console.log(x.id, "·", x.berlin, "·", x.grupo, "·", x.alumnos);
await c.end();
