import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT DISTINCT TO_CHAR(month, 'YYYY-MM-DD') AS m FROM teacher_earnings ORDER BY m`);
console.log("Months in teacher_earnings:", rows.map(r => r.m));
const { rows: apr } = await db.query(`SELECT COUNT(*) AS n, SUM(amount_cents)/100 AS total FROM teacher_earnings WHERE TO_CHAR(month, 'YYYY-MM') = '2026-04'`);
console.log("April via TO_CHAR filter:", apr);
const { rows: chl } = await db.query(`SELECT DISTINCT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS t FROM class_hours_log ORDER BY t DESC LIMIT 5`);
console.log("class_hours_log last 5 timestamps:", chl.map(r => r.t));
await db.end();
