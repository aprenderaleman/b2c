// Busca a Francisco (catalan_640@hotmail.com) en TODAS las grabaciones del
// grupo "Deutsch A1 - B1 Abends" (Florian), no solo las que están asignadas
// a su class_participants.

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
const enc = u => u.startsWith("/")||u.includes("//")?encodeURIComponent(encodeURIComponent(u)):encodeURIComponent(u);

const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// Sacar TODAS las clases del grupo Abends con zoom_uuid
const { rows: classes } = await c.query(`
  SELECT c.id, c.scheduled_at, c.notes_admin, c.title,
         (SELECT array_agg(u.email) FROM class_participants cp
            JOIN students s ON s.id=cp.student_id JOIN users u ON u.id=s.user_id
           WHERE cp.class_id = c.id) AS asignados
    FROM classes c
   WHERE (c.title ILIKE '%Abends%' OR c.title ILIKE '%Abend%')
     AND c.notes_admin ILIKE 'zoom_uuid=%'
     AND c.status='completed'
   ORDER BY c.scheduled_at`);

console.log(`Clases Abends con zoom_uuid: ${classes.length}\n`);

const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

// Buscar Francisco en cada una
const fcoTokens = ["francisco", "paco", "fran", "catalan"];

const matches = [];
const allParticipants = new Map();  // nombre/email único → fechas

for (const k of classes) {
  const uuid = k.notes_admin.match(/zoom_uuid=([^\s,;]+)/)?.[1];
  if (!uuid) continue;
  const r = await fetch(`https://api.zoom.us/v2/past_meetings/${enc(uuid)}/participants?page_size=100`,
    { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!r.ok) { continue; }
  const j = await r.json();
  for (const p of (j.participants ?? [])) {
    const key = `${p.name}|${p.user_email||""}`;
    if (!allParticipants.has(key)) allParticipants.set(key, []);
    allParticipants.get(key).push(k.scheduled_at.toISOString().slice(0,10));

    const name = norm(p.name);
    const email = (p.user_email||"").toLowerCase();
    const isFco = fcoTokens.some(t => name.includes(t)) || email === "catalan_640@hotmail.com" || email.includes("catalan");
    if (isFco) {
      matches.push({ date: k.scheduled_at.toISOString().slice(0,10), name: p.name, email: p.user_email, dur: p.duration, classId: k.id, asignados: k.asignados });
    }
  }
}

console.log(`══════════ Coincidencias con tokens "francisco/paco/fran/catalan" ══════════`);
for (const m of matches) console.log(`  ${m.date}  "${m.name}" <${m.email||"—"}>  dur=${m.dur}s  asignados-en-BD=${m.asignados?.join(",")||"—"}`);

console.log(`\n══════════ TODOS los participantes únicos del grupo Abends ══════════`);
const sorted = [...allParticipants.entries()].sort((a,b)=>b[1].length - a[1].length);
for (const [key, dates] of sorted) {
  console.log(`  ${dates.length.toString().padStart(3)}× ${key}  (${dates[0]} → ${dates[dates.length-1]})`);
}

await c.end();
