// Ejecutar desde la raíz del repo:  node scripts/apply_151.mjs
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const sql = readFileSync(resolve(process.cwd(), "db/migrations/151_students_acuerdo_cierre.sql"), "utf8");
try {
  await client.query(sql);
  console.log("Migration 151 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
}

const r = await client.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name='students' AND column_name IN ('acuerdo_cierre','acuerdo_cierre_nota','access_until')",
);
console.log("columnas presentes:", r.rows.map((x) => x.column_name));
await client.end();
