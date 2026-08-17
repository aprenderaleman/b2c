import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = readFileSync(resolve(process.cwd(), "db/migrations/111_closer_google_credentials.sql"), "utf8");
try {
  await client.query(sql);
  console.log("Migration 111 applied OK");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
}

// Verificación
try {
  const r1 = await client.query("SELECT COUNT(*) FROM closer_google_credentials");
  console.log("closer_google_credentials rows:", r1.rows[0].count);
  const r2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='classes' AND column_name='closer_gcal_event_id'");
  console.log("classes.closer_gcal_event_id column present:", r2.rows.length === 1);
} catch (e) {
  console.error("verify FAIL:", e.message);
}

await client.end();
