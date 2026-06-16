import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";
config({ path: resolve(process.cwd(), ".env") });

const file = "db/migrations/065_ads_attended_tracking.sql";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log(`--- Running ${file} ---`);
try {
  await client.query(fs.readFileSync(file, "utf-8"));
  console.log(`OK: ${file}`);
} catch (err) {
  console.error(`FAIL: ${file}`, err.message);
  await client.end(); process.exit(1);
}

// Smoke test
const { rows: cols } = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='leads' AND column_name IN ('ads_attended_uploaded_at','ads_conversion_uploaded_at')
  ORDER BY column_name
`);
console.log("Columnas presentes:", cols.map(r => r.column_name));

// Cuántos leads están pendientes de subir
const { rows: counts } = await client.query(`
  SELECT
    COUNT(*) FILTER (
      WHERE gclid IS NOT NULL AND trial_attended_at IS NOT NULL
        AND ads_attended_uploaded_at IS NULL
    ) AS pending_attended,
    COUNT(*) FILTER (
      WHERE gclid IS NOT NULL AND status='converted'
        AND ads_conversion_uploaded_at IS NULL
    ) AS pending_paid
  FROM leads
`);
console.log("Pendientes de subir a Google Ads:", counts[0]);

await client.end();
console.log("Done.");
