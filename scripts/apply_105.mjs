import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(fs.readFileSync("db/migrations/105_payments_invoice_dedup.sql", "utf-8"));
  console.log("Migration 105 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
}
await client.end();
