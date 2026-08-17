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

const r = await c.query(`
  SELECT timestamp, type, lead_id, LEFT(content, 80) AS preview
    FROM lead_timeline
   WHERE timestamp > NOW() - INTERVAL '15 minutes'
   ORDER BY timestamp DESC LIMIT 30`);
console.log(`Eventos lead_timeline últimos 15 min:`);
for (const row of r.rows) {
  console.log(`  ${row.timestamp.toISOString().slice(11,19)}  ${row.type.padEnd(28)}  ${row.lead_id?.slice(0,8) ?? "—"}  ${row.preview ?? ""}`);
}

console.log(`\nEventos por tipo en última hora:`);
const r2 = await c.query(`
  SELECT type, COUNT(*)::int AS n, MAX(timestamp) AS last_at
    FROM lead_timeline
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY type ORDER BY MAX(timestamp) DESC`);
for (const row of r2.rows) {
  console.log(`  ${row.type.padEnd(30)}  n=${row.n}  último=${row.last_at.toISOString().slice(11,19)}`);
}

// Verificar que mi Test 1 quedó en message_send_log
console.log(`\nÚltimos 5 mensajes en message_send_log:`);
const r3 = await c.query(`
  SELECT sent_at, instance, to_number, success, retry_count,
         LEFT(message_body, 60) AS preview
    FROM message_send_log
   ORDER BY sent_at DESC LIMIT 5`);
for (const row of r3.rows) {
  console.log(`  ${row.sent_at?.toISOString?.()?.slice(11,19) ?? "—"}  to=${row.to_number}  ok=${row.success}  "${row.preview}"`);
}
await c.end();
