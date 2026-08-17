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
await c.query("BEGIN");

try {
  const LEAD_ID = "9f589e13-11f1-427c-98be-8743f3583b51";  // Christian Moresi

  // Antes
  const { rows: before } = await c.query(`
    SELECT id, timestamp, type, LEFT(content, 60) AS content
      FROM lead_timeline
     WHERE lead_id = $1
       AND timestamp BETWEEN '2026-04-29T19:03:30Z' AND '2026-04-29T19:04:00Z'
     ORDER BY timestamp`, [LEAD_ID]);
  console.log("ANTES — eventos de Christian 19:03:30→19:04:00:");
  for (const r of before) console.log(`  ${r.timestamp.toISOString().slice(11,23)}  ${r.type.padEnd(28)}  ${r.content}  id=${r.id.slice(0,8)}`);

  // Borrar:
  //   • el 2do "Ich wollte nur bestätigen" (19:03:36) — duplicado del de 19:03:33
  //   • el "Hallo Christian!" de 19:03:45 — duplicado del de 19:03:07
  //   • el 2do "Ja" de 19:03:46 — duplicado del de 19:02:58
  //   • el "Hallo Christian!" de 19:03:55 — triplicado del de 19:03:07
  const { rowCount: del } = await c.query(`
    DELETE FROM lead_timeline
     WHERE lead_id = $1
       AND id IN (
         SELECT id FROM (
           SELECT id, type, content, timestamp,
                  ROW_NUMBER() OVER (PARTITION BY type, content ORDER BY timestamp) AS rn
             FROM lead_timeline
            WHERE lead_id = $1
              AND timestamp BETWEEN '2026-04-29T19:03:30Z' AND '2026-04-29T19:04:00Z'
              AND content IN (
                'Ich wollte nur bestätigen',
                'Hallo Christian! 👋

Du hast deine Probestunde am Thursday, 30.04.2026 um 14:00 (Berlin) mit Gelfis Horn.

Wie kann ich dir helfen?

— Stiv · Aprender-Aleman.de'
              )
         ) sub
        WHERE rn > 1
       )
       OR id IN (
         SELECT id FROM lead_timeline
          WHERE lead_id = $1
            AND timestamp = '2026-04-29T19:03:46.551Z'
            AND type = 'lead_message_received'
            AND content = 'Ja'
       )`, [LEAD_ID]);
  console.log(`\nFilas borradas: ${del}`);

  const { rows: after } = await c.query(`
    SELECT id, timestamp, type, LEFT(content, 60) AS content
      FROM lead_timeline
     WHERE lead_id = $1
       AND timestamp BETWEEN '2026-04-29T19:02:00Z' AND '2026-04-29T19:05:00Z'
     ORDER BY timestamp`, [LEAD_ID]);
  console.log("\nDESPUÉS — timeline limpia:");
  for (const r of after) console.log(`  ${r.timestamp.toISOString().slice(11,23)}  ${r.type.padEnd(28)}  ${r.content}`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}
await c.end();
