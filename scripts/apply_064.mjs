import { config } from "dotenv";
import { resolve } from "path";
import fs from "node:fs";
import pg from "pg";

config({ path: resolve(process.cwd(), ".env") });

const file = "db/migrations/064_motivo_direct.sql";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log(`--- Running ${file} ---`);
const sql = fs.readFileSync(file, "utf-8");
try {
  await client.query(sql);
  console.log(`OK: ${file}`);
} catch (err) {
  console.error(`FAIL: ${file}`, err.message);
  process.exitCode = 1;
  await client.end();
  process.exit(1);
}

// Smoke test: verifica que 'direct' es ahora un valor válido
try {
  await client.query("BEGIN");
  const { rows } = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname IN ('leads', 'lead_motivo_inicial')
      AND c.conname LIKE '%motivo%'
    ORDER BY t.relname
  `);
  console.log("Constraints actualizadas:");
  for (const r of rows) console.log("  ", r.def);
  await client.query("ROLLBACK");
} catch (err) {
  console.warn("Smoke check failed:", err.message);
  await client.query("ROLLBACK").catch(() => {});
}

await client.end();
console.log("\nDone.");
