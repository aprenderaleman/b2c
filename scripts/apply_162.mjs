import { readFileSync } from "node:fs";
import { Client } from "pg";
const sql = readFileSync(new URL("../db/migrations/162_deactivate_more_wa.sql", import.meta.url), "utf8");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("SET client_encoding = 'UTF8'");
await c.query(sql);
const t = await c.query(`
  SELECT kind, count(*) FILTER (WHERE active) AS activas, count(*) AS total
    FROM message_templates
   WHERE channel='whatsapp'
     AND kind IN ('chain3_obj_precio','chain3_obj_pensarlo','chain3_obj_pareja','chain3_obj_tiempo','chain5_reschedule','chain6_cancel','pack_milestone','dormant_monthly_nudge')
GROUP BY kind ORDER BY kind
`);
console.log("Templates:");
for (const r of t.rows) console.log(`  ${r.kind}: activas=${r.activas}/${r.total}`);
const l = await c.query(`
  SELECT chain_type, count(*) AS n
    FROM lead_chains
   WHERE completed_at IS NULL
GROUP BY chain_type ORDER BY chain_type
`);
console.log("Lead_chains activas restantes:");
for (const r of l.rows) console.log(`  ${r.chain_type}: ${r.n}`);
await c.end();
