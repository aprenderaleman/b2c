// Lista todos los nombres únicos de participantes en las clases del grupo
// Morgens (donde Victoria figuraba) y en la clase de Francisco (Abends 4-20)
// para ver si entran con un nombre distinto al registrado.

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

const ZOOM = { ACCOUNT_ID:"DUPrhOnvSZ29OrQ0VoDr-w", CLIENT_ID:"lDvwsk8ET_eO8f3U23Tuvg", CLIENT_SECRET:"orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n" };
const basic = Buffer.from(`${ZOOM.CLIENT_ID}:${ZOOM.CLIENT_SECRET}`).toString("base64");
const tr = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM.ACCOUNT_ID}`, { method:"POST", headers:{Authorization:`Basic ${basic}`} });
const TOKEN = (await tr.json()).access_token;
function encUuid(u){return u.startsWith("/")||u.includes("//")?encodeURIComponent(encodeURIComponent(u)):encodeURIComponent(u);}

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// Caso Victoria — Morgens classes
console.log("══════════ Participantes en clases Morgens donde Victoria figuraba ══════════");
const { rows: victoriaClasses } = await c.query(`
  SELECT c.scheduled_at, c.notes_admin
    FROM class_participants cp JOIN classes c ON c.id=cp.class_id
    JOIN students st ON st.id=cp.student_id JOIN users u ON u.id=st.user_id
   WHERE u.email='victoriaavilesgonzalez@gmail.com'
     AND c.notes_admin ILIKE 'zoom_uuid=%'
   ORDER BY c.scheduled_at LIMIT 5`);

for (const r of victoriaClasses) {
  const uuid = r.notes_admin.match(/zoom_uuid=([^\s,;]+)/)?.[1];
  if (!uuid) continue;
  const pr = await fetch(`https://api.zoom.us/v2/past_meetings/${encUuid(uuid)}/participants?page_size=100`,
    { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!pr.ok) { console.log(`  ${r.scheduled_at.toISOString().slice(0,10)} → ${pr.status}`); continue; }
  const j = await pr.json();
  console.log(`\n  ${r.scheduled_at.toISOString().slice(0,10)} (${j.participants?.length ?? 0} participantes):`);
  for (const p of (j.participants ?? [])) {
    console.log(`    - "${p.name}" <${p.user_email||"—"}>  dur=${p.duration}s`);
  }
}

console.log("\n══════════ Participantes en clase Abends 4-20 (Francisco) ══════════");
const { rows: fco } = await c.query(`
  SELECT c.scheduled_at, c.notes_admin
    FROM class_participants cp JOIN classes c ON c.id=cp.class_id
    JOIN students st ON st.id=cp.student_id JOIN users u ON u.id=st.user_id
   WHERE u.email='catalan_640@hotmail.com'
     AND c.notes_admin ILIKE 'zoom_uuid=%'`);
for (const r of fco) {
  const uuid = r.notes_admin.match(/zoom_uuid=([^\s,;]+)/)?.[1];
  const pr = await fetch(`https://api.zoom.us/v2/past_meetings/${encUuid(uuid)}/participants?page_size=100`,
    { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!pr.ok) { console.log(`  ${r.scheduled_at.toISOString().slice(0,10)} → ${pr.status}`); continue; }
  const j = await pr.json();
  console.log(`\n  ${r.scheduled_at.toISOString().slice(0,10)} (${j.participants?.length ?? 0}):`);
  for (const p of (j.participants ?? [])) {
    console.log(`    - "${p.name}" <${p.user_email||"—"}>  dur=${p.duration}s`);
  }
}

// Datos del usuario en BD para entender variantes
console.log("\n══════════ Datos en BD ══════════");
for (const em of ['victoriaavilesgonzalez@gmail.com','catalan_640@hotmail.com']) {
  const r = await c.query(`SELECT u.full_name, u.email, l.name AS lead_name, l.whatsapp_normalized
                             FROM users u
                             JOIN students s ON s.user_id=u.id
                        LEFT JOIN leads l ON l.id=s.lead_id
                            WHERE u.email=$1`, [em]);
  console.log(`  ${em}: full_name="${r.rows[0]?.full_name}" lead_name="${r.rows[0]?.lead_name}" wa=${r.rows[0]?.whatsapp_normalized}`);
}

await c.end();
