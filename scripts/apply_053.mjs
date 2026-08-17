import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });

const sql = fs.readFileSync("db/migrations/053_german_level_sublevels.sql", "utf-8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Split on semicolons + filter, run each statement separately so that
// ALTER TYPE ADD VALUE doesn't try to share a transaction.
const stmts = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith("--"));

for (const stmt of stmts) {
  const firstLine = stmt.split("\n").find(l => !l.trim().startsWith("--")) || stmt.slice(0, 80);
  process.stdout.write(`→ ${firstLine.slice(0, 100)} ... `);
  try {
    await client.query(stmt);
    console.log("ok");
  } catch (e) {
    console.log("FAIL:", e.message);
  }
}

const r = await client.query(
  "SELECT unnest(enum_range(NULL::german_level))::text AS level ORDER BY 1",
);
console.log("\nFinal enum values:", r.rows.map(x => x.level).join(", "));

await client.end();
