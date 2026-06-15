import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });

const file = "db/migrations/063_trial_attendance_timestamps.sql";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log(`--- Running ${file} ---`);
const sql = fs.readFileSync(file, "utf-8");
try {
  await client.query(sql);
  console.log(`OK: ${file}`);
} catch (err) {
  console.error(`FAIL: ${file}`, err.message);
  process.exitCode = 1;
}

// Smoke test — verifica que las columnas existan + cuenta backfill
const { rows: cols } = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'leads'
    AND column_name IN ('trial_attended_at', 'trial_absent_at')
  ORDER BY column_name
`);
console.log("Columnas presentes:", cols.map(r => r.column_name));

const { rows: counts } = await client.query(`
  SELECT
    COUNT(*) FILTER (WHERE trial_scheduled_at IS NOT NULL)       AS scheduled,
    COUNT(*) FILTER (WHERE trial_attended_at IS NOT NULL)         AS attended_backfilled,
    COUNT(*) FILTER (WHERE trial_absent_at IS NOT NULL)           AS absent_backfilled,
    COUNT(*) FILTER (WHERE trial_scheduled_at IS NOT NULL
                       AND trial_attended_at IS NULL
                       AND trial_absent_at IS NULL)               AS pending
  FROM leads
`);
console.log("Counts después de backfill:", counts[0]);

await client.end();
console.log("\nDone.");
