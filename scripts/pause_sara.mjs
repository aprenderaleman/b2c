import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query("BEGIN");
try {
  const SARA = "05aff1cf-3a29-4058-8c5f-c854eedd1f83";
  // Marcamos como lost (ella misma dijo que se va a otra academia) + paused
  // ai_paused_until far future por seguridad, status lost limpia.
  await c.query(`
    UPDATE leads
       SET status = 'lost',
           next_contact_date = NULL,
           ai_paused_until = '9999-12-31'::timestamptz
     WHERE id = $1`, [SARA]);
  await c.query(`
    INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
    VALUES ($1, 'status_change', 'gelfis',
            'Marked LOST — Sara ya nos había dicho 29-abr 18:58 que se inscribe en academia presencial. El bot no leyó ese mensaje (LID desconocido + webhook caído) y luego al replay malinterpretó "Todo ok" como booking. Pausado para evitar más mensajes inapropiados.',
            NOW())`, [SARA]);
  await c.query("COMMIT");
  console.log("✓ Sara marcada como lost + ai_paused_until=9999. No recibirá más mensajes del bot.");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}
await c.end();
