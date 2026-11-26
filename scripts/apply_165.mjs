import { readFileSync } from "node:fs";
import { Client } from "pg";
const sql = readFileSync(new URL("../db/migrations/165_comision_pct_acordada.sql", import.meta.url), "utf8");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("SET client_encoding = 'UTF8'");
await c.query(sql);
const r = await c.query(`
  SELECT table_name, column_name, data_type
    FROM information_schema.columns
   WHERE column_name = 'comision_pct' AND table_name IN ('users', 'teacher_invitations')
ORDER BY table_name
`);
console.log("Columnas creadas:");
for (const x of r.rows) console.log(`  ${x.table_name}.${x.column_name} (${x.data_type})`);
await c.end();
