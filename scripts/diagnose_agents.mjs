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

console.log("=== AGENT_RUN_LOG — ÚLTIMOS 5 runs por agente ===");
const runs = await client.query(`
  WITH ranked AS (
    SELECT agent_name, started_at, finished_at, leads_processed, errors_count, notes,
           ROW_NUMBER() OVER (PARTITION BY agent_name ORDER BY started_at DESC) AS rn
    FROM agent_run_log
  )
  SELECT agent_name, started_at, finished_at, leads_processed, errors_count, notes
  FROM ranked WHERE rn <= 3
  ORDER BY agent_name, started_at DESC
`);
console.table(runs.rows);

console.log("\n=== HORAS DESDE ÚLTIMO RUN POR AGENTE ===");
const lastByAgent = await client.query(`
  SELECT agent_name, max(started_at) AS last_run,
         EXTRACT(EPOCH FROM (NOW() - max(started_at))) / 3600 AS hours_ago
  FROM agent_run_log
  GROUP BY agent_name
  ORDER BY last_run DESC
`);
console.table(lastByAgent.rows.map(r => ({
  agent: r.agent_name,
  last_run: r.last_run,
  hours_ago: Number(r.hours_ago).toFixed(1),
})));

console.log("\n=== MESSAGE_SEND_LOG — últimos 10 ===");
const msgs = await client.query(`
  SELECT sent_at, instance, to_number, success, retry_count,
         LEFT(COALESCE(error_message, ''), 60) AS err,
         LEFT(message_body, 50) AS msg_preview
  FROM message_send_log
  ORDER BY sent_at DESC NULLS LAST
  LIMIT 10
`);
console.table(msgs.rows);

console.log("\n=== Cuántos leads han acumulado pendientes ===");
const pending = await client.query(`
  SELECT
    count(*) FILTER (WHERE status = 'new' AND next_contact_date IS NULL) AS new_untouched,
    count(*) FILTER (WHERE next_contact_date IS NOT NULL AND next_contact_date <= NOW()) AS due_overdue,
    count(*) FILTER (WHERE status = 'trial_scheduled' AND trial_scheduled_at::date = CURRENT_DATE) AS trials_today
  FROM leads
`);
console.table(pending.rows);

await client.end();
