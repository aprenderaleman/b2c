#!/usr/bin/env node
/**
 * Los endpoints /report y /recordings fallan por scopes. Probamos
 * /users/{id}/meetings con varios `type` para listar meetings del host.
 * Para los que parezcan de Fernanda, recorremos sus instancias pasadas
 * con /past_meetings/{id}/instances (este sí funciona).
 */
const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";
const FLORIAN_EMAIL = "florian.zormann@gmx.at";

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
const { access_token: token } = await tokRes.json();

async function zget(path, ignore404=false) {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    if (ignore404 && r.status === 404) return null;
    const text = (await r.text()).slice(0, 200);
    throw new Error(`${r.status} ${path}: ${text}`);
  }
  return r.json();
}
function encUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

const florian = await zget(`/users/${FLORIAN_EMAIL}`);
console.log(`Host: ${florian.first_name} ${florian.last_name} (id=${florian.id})\n`);

// Probar varios tipos para listar meetings del host
const types = ["scheduled", "live", "upcoming", "previous_meetings", "previous_webinars"];
const allMeetings = new Map();   // dedup por id

for (const t of types) {
  let next_page_token = "";
  let pages = 0;
  do {
    pages++;
    const path = `/users/${florian.id}/meetings?type=${t}&page_size=300${next_page_token?`&next_page_token=${encodeURIComponent(next_page_token)}`:""}`;
    let data;
    try { data = await zget(path); }
    catch (e) { console.log(`  ✗ type=${t}: ${e.message?.slice(0,100)}`); break; }
    for (const m of (data.meetings ?? [])) {
      allMeetings.set(m.id, { ...m, _foundIn: t });
    }
    next_page_token = data.next_page_token ?? "";
  } while (next_page_token && pages < 5);
  console.log(`  type=${t}: total acumulado ${allMeetings.size}`);
}

const meetings = [...allMeetings.values()];
console.log(`\nTotal meetings únicos del host Florian: ${meetings.length}`);

// Imprimir todos
console.log(`\n══════════ Meetings (deduplicados) ══════════`);
for (const m of meetings) {
  const next = m.start_time ? m.start_time.slice(0,16) : "—";
  const created = m.created_at ? m.created_at.slice(0,16) : "—";
  console.log(`  id=${m.id}  topic="${(m.topic??'').slice(0,50)}"  next=${next}  created=${created}  type=${m.type}  src=${m._foundIn}`);
}

// Detectar los que son posiblemente de Fernanda y consultar sus instancias
const fernandaCandidates = meetings.filter(m =>
  /fernanda/i.test(m.topic ?? "") ||
  /keller/i.test(m.topic ?? "") ||
  // Patrones clásicos de meeting personal
  m.id === 85833907996,
);

console.log(`\n══════════ Candidatos Fernanda: ${fernandaCandidates.length} ══════════`);
let totalPre = 0, totalPost = 0;
for (const m of fernandaCandidates) {
  console.log(`\n— Meeting ${m.id} "${m.topic}"`);
  const inst = await zget(`/past_meetings/${m.id}/instances`, true);
  if (!inst || !inst.meetings) {
    console.log(`  (sin instancias pasadas o no accesible)`);
    continue;
  }
  console.log(`  instancias: ${inst.meetings.length}`);
  for (const i of inst.meetings) {
    try {
      const det = await zget(`/past_meetings/${encUuid(i.uuid)}`);
      const day = det.start_time?.slice(0,10) ?? "";
      const isPre = day < "2026-02-17";
      if (det.duration >= 30) {
        if (isPre) totalPre++; else totalPost++;
      }
      console.log(`    ${det.start_time?.slice(0,16)}  ${String(det.duration).padStart(3)}min  parts=${det.participants_count}  ${isPre?"🔴 PRE":"✓ post"}`);
    } catch (e) {
      console.log(`    ✗ ${i.uuid}: ${e.message?.slice(0,60)}`);
    }
  }
}
console.log(`\n══════════ TOTAL ≥30min  PRE-17feb: ${totalPre}  ·  17feb+: ${totalPost} ══════════`);
