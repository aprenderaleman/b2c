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
  // Buscar de forma robusta los 2 que faltan
  const LEAD_ID = "9f589e13-11f1-427c-98be-8743f3583b51";
  const { rows: dups } = await c.query(`
    SELECT id, timestamp, type, LEFT(content, 60) AS content
      FROM lead_timeline
     WHERE lead_id = $1
       AND timestamp >= '2026-04-29T19:03:40Z'
       AND timestamp <  '2026-04-29T19:04:00Z'
     ORDER BY timestamp`, [LEAD_ID]);
  console.log("\nFilas en 19:03:40→19:04:00:");
  for (const r of dups) console.log(`  ${r.id}  ${r.timestamp.toISOString().slice(11,23)}  ${r.type.padEnd(28)}  ${r.content}`);

  // Identificar duplicados explícitamente:
  //   - El "Hallo Christian!" de 19:03:45 (duplicado del de 19:03:07)
  //   - El "Ja" de 19:03:46 (duplicado del de 19:02:58)
  const idsToDelete = dups
    .filter(r =>
      (r.type === "system_message_sent" && r.content.startsWith("Hallo Christian!"))
      || (r.type === "lead_message_received" && r.content.trim() === "Ja"))
    .map(r => r.id);
  console.log(`\n→ ids a borrar: ${idsToDelete.join(", ")}`);

  if (idsToDelete.length > 0) {
    const { rowCount: del } = await c.query(
      `DELETE FROM lead_timeline WHERE id = ANY($1::uuid[])`,
      [idsToDelete],
    );
    console.log(`Borradas: ${del}`);
  }

  // Resultado final
  const { rows: after } = await c.query(`
    SELECT timestamp, type, LEFT(content, 70) AS content
      FROM lead_timeline
     WHERE lead_id = $1
       AND timestamp BETWEEN '2026-04-29T19:02:00Z' AND '2026-04-29T19:05:00Z'
     ORDER BY timestamp`, [LEAD_ID]);
  console.log("\n══════════ TIMELINE FINAL DE CHRISTIAN ══════════");
  for (const r of after) console.log(`  ${r.timestamp.toISOString().slice(11,23)}  ${r.type.padEnd(28)}  ${r.content}`);

  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}
await c.end();
