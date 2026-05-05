// Búsqueda exhaustiva de Francisco en TODOS los meetings/grabaciones del
// account de Zoom (no solo en el meeting Abends).

import fs from "node:fs";
const ZOOM = { ACCOUNT_ID:"DUPrhOnvSZ29OrQ0VoDr-w", CLIENT_ID:"lDvwsk8ET_eO8f3U23Tuvg", CLIENT_SECRET:"orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n" };
const basic = Buffer.from(`${ZOOM.CLIENT_ID}:${ZOOM.CLIENT_SECRET}`).toString("base64");
const tr = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM.ACCOUNT_ID}`, { method:"POST", headers:{Authorization:`Basic ${basic}`} });
const TOKEN = (await tr.json()).access_token;
const enc = u => u.startsWith("/")||u.includes("//")?encodeURIComponent(encodeURIComponent(u)):encodeURIComponent(u);

// 1) Listar usuarios del account → encontrar Florian
const ur = await fetch("https://api.zoom.us/v2/users?status=active&page_size=100", { headers:{Authorization:`Bearer ${TOKEN}`} });
const users = (await ur.json()).users ?? [];
console.log(`Usuarios del account: ${users.length}`);
for (const u of users) console.log(`  ${u.id}  ${u.first_name} ${u.last_name} <${u.email}>`);

// 2) Para cada usuario, listar grabaciones desde 2026-02-01
const fcoTokens = ["francisco", "paco", "fran", "catalan"];
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g,"").trim();

const matches = [];
const allRecordings = [];

for (const u of users) {
  let nextToken = "";
  let from = "2026-02-01";
  // Zoom max range = 1 month, así que iteramos por meses
  for (const mes of ["2026-02", "2026-03", "2026-04", "2026-05"]) {
    const start = `${mes}-01`;
    const yy = parseInt(mes.slice(0,4));
    const mm = parseInt(mes.slice(5,7));
    const last = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0,10);
    let pageToken = "";
    do {
      const url = `https://api.zoom.us/v2/users/${encodeURIComponent(u.id)}/recordings?from=${start}&to=${last}&page_size=300${pageToken?`&next_page_token=${pageToken}`:""}`;
      const r = await fetch(url, { headers:{Authorization:`Bearer ${TOKEN}`} });
      if (!r.ok) { console.log(`  ✗ recordings ${u.email} ${mes}: ${r.status}`); break; }
      const j = await r.json();
      for (const m of (j.meetings ?? [])) {
        allRecordings.push({ host: u.email, ...m });
      }
      pageToken = j.next_page_token ?? "";
    } while (pageToken);
  }
}
console.log(`\nTotal grabaciones encontradas (todos los usuarios, feb-may): ${allRecordings.length}`);

// 3) Para cada grabación con UUID, sacar participants y buscar Francisco
console.log("\nBuscando Francisco en todas las grabaciones…\n");
let count = 0;
for (const rec of allRecordings) {
  const uuid = rec.uuid;
  if (!uuid) continue;
  const u = enc(uuid);
  const pr = await fetch(`https://api.zoom.us/v2/past_meetings/${u}/participants?page_size=100`, { headers:{Authorization:`Bearer ${TOKEN}`} });
  if (!pr.ok) continue;
  const j = await pr.json();
  for (const p of (j.participants ?? [])) {
    const name = norm(p.name);
    const email = (p.user_email||"").toLowerCase();
    if (fcoTokens.some(t => name.includes(t)) || email.includes("catalan") || email === "catalan_640@hotmail.com") {
      matches.push({
        host: rec.host, topic: rec.topic, start: rec.start_time,
        meetingId: rec.id, uuid: uuid,
        pName: p.name, pEmail: p.user_email, dur: p.duration,
      });
    }
  }
  count++;
  if (count % 50 === 0) console.log(`  procesadas ${count}/${allRecordings.length}…`);
}

console.log(`\n══════════ Coincidencias con Francisco ══════════`);
if (matches.length === 0) console.log("  NINGUNA en todo el account de Zoom (feb–may)");
for (const m of matches) {
  console.log(`  ${m.start}  host=${m.host}  topic="${m.topic}"`);
  console.log(`     "${m.pName}" <${m.pEmail||"—"}>  dur=${m.dur}s  uuid=${m.uuid}`);
}
