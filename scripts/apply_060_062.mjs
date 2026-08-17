import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });

const migrations = [
  "db/migrations/060_costes_fijos.sql",
  "db/migrations/061_stripe_integration.sql",
  "db/migrations/062_google_ads_daily.sql",
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const file of migrations) {
  console.log(`\n--- Running ${file} ---`);
  const sql = fs.readFileSync(file, "utf-8");
  try {
    await client.query(sql);
    console.log(`OK: ${file}`);
  } catch (err) {
    console.error(`FAIL: ${file}`, err.message);
  }
}

await client.end();
console.log("\nDone.");
