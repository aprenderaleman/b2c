// Aplica db/migrations/160_post_trial_followups.sql a producción.
// Uso: node --env-file=.env scripts/apply_160.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";
const sql = readFileSync(new URL("../db/migrations/160_post_trial_followups.sql", import.meta.url), "utf8");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("SET client_encoding = 'UTF8'");
await client.query(sql);
const check = await client.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='post_trial_followups' ORDER BY ordinal_position"
);
console.log("Columnas:", check.rows.map(r => `${r.column_name}:${r.data_type}`).join(", "));
await client.end();
