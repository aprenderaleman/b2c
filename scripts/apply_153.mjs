// Ejecutar desde la raíz del repo:  node scripts/apply_153.mjs
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const sql = readFileSync(resolve(process.cwd(), "db/migrations/153_catalog_plans_stripe_link_flexible.sql"), "utf8");
try {
  await client.query(sql);
  console.log("Migration 153 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
}

const r = await client.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name='catalog_plans' AND column_name='stripe_link_flexible'",
);
console.log("columnas presentes:", r.rows.map((x) => x.column_name));
await client.end();
