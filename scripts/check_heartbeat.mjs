#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const beats = await client.query(`
  SELECT service, last_tick, cycle_count, last_note,
         EXTRACT(EPOCH FROM (NOW() - last_tick)) AS age_s
  FROM system_heartbeat ORDER BY service
`);
console.log("=== HEARTBEATS ===");
for (const r of beats.rows) {
  console.log(`  ${r.service.padEnd(12)} age=${Math.round(r.age_s)}s  cycles=${r.cycle_count}  note="${r.last_note}"`);
}

const crit = await client.query(`SELECT value FROM system_config WHERE key = 'last_critical_issue'`);
console.log(`\ncritical_issue: "${crit.rows[0]?.value ?? ''}"`);

await client.end();
