// Aplica db/migrations/161_deactivate_wa_chains.sql a producción.
// Uso: node --env-file=.env scripts/apply_161.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";
const sql = readFileSync(new URL("../db/migrations/161_deactivate_wa_chains.sql", import.meta.url), "utf8");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("SET client_encoding = 'UTF8'");
await client.query(sql);
const t = await client.query(`
  SELECT kind, count(*) FILTER (WHERE active) AS activas, count(*) AS total
    FROM message_templates
   WHERE channel='whatsapp'
     AND kind IN ('chain1_attended','chain1_attended_bonus_vivo','chain2_link_sent','chain4_absent','chain4_absent_deposit','chain4_absent_nodeposit','welcome_week','welcome_week_celebration')
GROUP BY kind ORDER BY kind
`);
console.log("Templates:");
for (const r of t.rows) console.log(`  ${r.kind}: activas=${r.activas}/${r.total}`);
const c = await client.query(`
  SELECT chain_type, count(*) AS n
    FROM lead_chains
   WHERE completed_at IS NULL
GROUP BY chain_type ORDER BY chain_type
`);
console.log("Lead_chains activas (deben estar vacías para los 3 tipos):");
for (const r of c.rows) console.log(`  ${r.chain_type}: ${r.n}`);
await client.end();
