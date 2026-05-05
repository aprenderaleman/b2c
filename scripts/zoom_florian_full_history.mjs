// Saca TODAS las instancias del recurring meeting del grupo Abends (Florian)
// y busca a Francisco en cada una.

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

// Step 1: pillar el meeting_id del recurring desde uno de los uuids conocidos
const { rows: knownUuid } = await c.query(`
  SELECT notes_admin FROM classes
   WHERE title ILIKE '%Abends%' AND notes_admin LIKE 'zoom_uuid=%'
   ORDER BY scheduled_at DESC LIMIT 1`);
const sampleUuid = knownUuid[0].notes_admin.match(/zoom_uuid=([^\s,;]+)/)[1];
console.log(`Sample uuid: ${sampleUuid}`);

const detRes = await fetch(`https://api.zoom.us/v2/past_meetings/${enc(sampleUuid)}`, { headers:{Authorization:`Bearer ${TOKEN}`} });
if (!detRes.ok) { console.error(detRes.status, await detRes.text()); process.exit(1); }
const det = await detRes.json();
const meetingId = det.id;
console.log(`Meeting ID: ${meetingId}  topic="${det.topic}"  host=${det.host_email}\n`);

// Step 2: listar todas las instancias pasadas
const insts = [];
let nextToken = "";
do {
  const url = `https://api.zoom.us/v2/past_meetings/${meetingId}/instances${nextToken ? `?next_page_token=${nextToken}` : ""}`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!r.ok) { console.error("instances:", r.status, await r.text()); break; }
  const j = await r.json();
  insts.push(...(j.meetings ?? []));
  nextToken = j.next_page_token;
} while (nextToken);
console.log(`Total instancias pasadas del recurring: ${insts.length}\n`);

// Step 3: para cada instancia desde 2026-04-15, sacar participantes y buscar Francisco
const fcoTokens = ["francisco", "paco", "fran", "catalan"];
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g,"").trim();
const matches = [];
const interesting = insts.filter(i => i.start_time >= "2026-04-15");
console.log(`Revisando ${interesting.length} instancias desde 15-abr…\n`);

for (const inst of interesting) {
  const u = enc(inst.uuid);
  const pr = await fetch(`https://api.zoom.us/v2/past_meetings/${u}/participants?page_size=100`, { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!pr.ok) { console.log(`  ${inst.start_time} → ${pr.status}`); continue; }
  const j = await pr.json();
  const names = (j.participants ?? []).map(p => `${p.name}<${p.user_email||"—"}>`).join(", ");
  console.log(`  ${inst.start_time}  uuid=${inst.uuid.slice(0,18)}…  participants: ${names}`);
  for (const p of (j.participants ?? [])) {
    const name = norm(p.name);
    const email = (p.user_email||"").toLowerCase();
    if (fcoTokens.some(t => name.includes(t)) || email.includes("catalan") || email === "catalan_640@hotmail.com") {
      matches.push({ start: inst.start_time, uuid: inst.uuid, name: p.name, email: p.user_email, dur: p.duration });
    }
  }
}

console.log(`\n══════════ Coincidencias con Francisco ══════════`);
if (matches.length === 0) console.log("  NINGUNA");
for (const m of matches) console.log(`  ${m.start}  "${m.name}" <${m.email||"—"}>  dur=${m.dur}s  uuid=${m.uuid}`);

await c.end();
