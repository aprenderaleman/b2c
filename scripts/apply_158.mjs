import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = readFileSync("db/migrations/158_classes_student_confirmed.sql", "utf8");
try {
  await client.query(sql);
  console.log("158 applied OK");
  const r = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='classes' AND column_name LIKE 'student_confirmed%' ORDER BY column_name
  `);
  console.table(r.rows);
} catch (e) {
  console.error("FAIL:", e.message);
}
await client.end();
