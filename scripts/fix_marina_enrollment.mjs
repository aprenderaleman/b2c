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
const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// Backfill class_participants for ALL students that are members of a group
// but missing rows in future scheduled classes of that group.
const r = await c.query(`
  WITH future_group_classes AS (
    SELECT c.id AS class_id, c.group_id
    FROM classes c
    WHERE c.status = 'scheduled'
      AND c.scheduled_at >= NOW()
      AND c.group_id IS NOT NULL
  ),
  expected AS (
    SELECT fgc.class_id, gm.student_id
    FROM future_group_classes fgc
    JOIN student_group_members gm ON gm.group_id = fgc.group_id
  ),
  missing AS (
    SELECT e.class_id, e.student_id
    FROM expected e
    LEFT JOIN class_participants cp
      ON cp.class_id = e.class_id AND cp.student_id = e.student_id
    WHERE cp.class_id IS NULL
  )
  INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
  SELECT class_id, student_id, NULL, TRUE FROM missing
  ON CONFLICT (class_id, student_id) DO NOTHING
  RETURNING class_id, student_id
`);
console.log(`Backfilled ${r.rows.length} class_participants rows.`);
// Group by student for visibility
const byStudent = {};
for (const row of r.rows) byStudent[row.student_id] = (byStudent[row.student_id] ?? 0) + 1;
console.table(Object.entries(byStudent).map(([student_id, count]) => ({ student_id, count })));

await c.end();
