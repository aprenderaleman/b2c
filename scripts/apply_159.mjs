// Aplica db/migrations/159_welcome_week_refresh.sql a producción.
// Uso: node --env-file=web/.env scripts/apply_159.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";

const sql = readFileSync(new URL("../db/migrations/159_welcome_week_refresh.sql", import.meta.url), "utf8");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query("SET client_encoding = 'UTF8'");
const res = await client.query(sql);
console.log("Rows affected:", res.rowCount ?? res?.length ?? "ok");
// Verificar nuevo body
const check = await client.query(
  "SELECT sub_n, substring(body FROM 1 FOR 80) AS preview FROM message_templates WHERE kind='welcome_week' AND sub_n=1 AND channel='whatsapp'"
);
console.log("Preview:", check.rows[0]);
await client.end();
