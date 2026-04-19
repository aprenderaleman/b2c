import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const __d = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__d, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`SELECT service, last_tick, last_note, EXTRACT(EPOCH FROM (NOW() - last_tick))/60 AS minutes_ago FROM system_heartbeat ORDER BY service`);
for (const r of rows) console.log(`${r.service.padEnd(12)} ${Number(r.minutes_ago).toFixed(1).padStart(6)} min ago  note="${r.last_note}"`);
const { rows: cfg } = await c.query(`SELECT value FROM system_config WHERE key = 'last_critical_issue'`);
console.log('critical banner:', JSON.stringify(cfg[0]?.value ?? '(empty)'));
await c.end();
