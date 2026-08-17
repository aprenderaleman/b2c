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

console.log("══════════ LYDIA — usuarios ══════════");
const { rows: users } = await c.query(`
  SELECT u.id, u.full_name, u.email, u.role, u.active, u.last_login_at, u.must_change_password, u.created_at
    FROM users u
   WHERE LOWER(u.full_name) LIKE '%lydia%' OR LOWER(u.email) LIKE '%lydia%'`);
for (const u of users) {
  console.log(`  ${u.id.slice(0,8)}  ${u.full_name}  ${u.email}  role=${u.role}  active=${u.active}  must_change_pwd=${u.must_change_password}  last_login=${u.last_login_at?.toISOString?.()?.slice(0,16) ?? "NUNCA"}`);
}

if (users.length === 0) {
  console.log("\n══════════ LYDIA — leads ══════════");
  const { rows: leads } = await c.query(`
    SELECT id, name, email, whatsapp_normalized, status, language
      FROM leads WHERE LOWER(name) LIKE '%lydia%' OR LOWER(email) LIKE '%lydia%'`);
  for (const l of leads) console.log(`  ${l.id.slice(0,8)}  ${l.name}  ${l.email}  ${l.whatsapp_normalized}  status=${l.status} lang=${l.language}`);
}

console.log("\n══════════ LYDIA — estudiante ══════════");
const { rows: students } = await c.query(`
  SELECT s.id, u.full_name, u.email, s.classes_purchased, s.classes_remaining,
         s.subscription_status, s.current_level
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE LOWER(u.full_name) LIKE '%lydia%' OR LOWER(u.email) LIKE '%lydia%'`);
for (const s of students) console.log(`  ${s.id.slice(0,8)}  ${s.full_name}  ${s.email}  pack=${s.classes_remaining}/${s.classes_purchased}  level=${s.current_level}  sub=${s.subscription_status}`);

await c.end();
