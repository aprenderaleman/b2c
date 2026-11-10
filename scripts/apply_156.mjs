// Ejecutar desde la raíz del repo:  node scripts/apply_156.mjs
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const sql = readFileSync(resolve(process.cwd(), "db/migrations/156_leads_profe_add_sina.sql"), "utf8");
try {
  await client.query(sql);
  console.log("Migration 156 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
}

const r = await client.query(
  "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='leads_profe_check'",
);
console.log("constraint:", r.rows[0]?.def);
await client.end();
