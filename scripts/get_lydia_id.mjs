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
const r = await c.query(`SELECT id, email, full_name FROM users WHERE LOWER(full_name) LIKE 'lydia%' OR LOWER(email) LIKE '%lydia%'`);
console.log(`Encontrados: ${r.rows.length}`);
for (const u of r.rows) console.log(`  ID: ${u.id}  full_name=${u.full_name}  email=${u.email}`);
await c.end();
