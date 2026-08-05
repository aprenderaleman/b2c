import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });

const sql = fs.readFileSync("db/migrations/104_teacher_invitations_v2.sql", "utf-8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query(sql);
  console.log("Migration 104 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
}

const r = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'teacher_invitations' ORDER BY ordinal_position
`);
console.log("teacher_invitations columns:", r.rows.map(x => x.column_name).join(", "));

const r2 = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'teachers' AND column_name IN ('timezone', 'availability_prefs')
`);
console.log("teachers new columns:", r2.rows.map(x => x.column_name).join(", "));

await client.end();
