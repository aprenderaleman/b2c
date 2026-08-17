#!/usr/bin/env node
/**
 * El endpoint /report falla por permisos. Probamos vía cloud recordings:
 * /users/{userId}/recordings?from=Y&to=Y devuelve todas las grabaciones
 * subidas por el host. Si Florian grababa las clases con Fernanda,
 * podremos contarlas mes a mes.
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

async function zget(path) {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const text = (await r.text()).slice(0, 250);
    throw new Error(`${r.status} ${path}: ${text}`);
  }
  return r.json();
}

const florian = await zget(`/users/${FLORIAN_EMAIL}`);
console.log(`Host: ${florian.first_name} ${florian.last_name} (id=${florian.id})\n`);

// Recorrer mes a mes para no exceder rangos máximos del API
const months = [];
const cur = new Date("2025-09-01T00:00:00Z");
const today = new Date();
while (cur < today) {
  const next = new Date(cur);
  next.setUTCMonth(next.getUTCMonth() + 1);
  months.push({
    from: cur.toISOString().slice(0,10),
    to: new Date(Math.min(next.getTime() - 86400_000, today.getTime())).toISOString().slice(0,10),
  });
  cur.setUTCMonth(cur.getUTCMonth() + 1);
}

const all = [];
for (const m of months) {
  let next_page_token = "";
  for (let pg = 0; pg < 5; pg++) {
    const path = `/users/${florian.id}/recordings?from=${m.from}&to=${m.to}&page_size=300${next_page_token?`&next_page_token=${encodeURIComponent(next_page_token)}`:""}`;
    let data;
    try { data = await zget(path); }
    catch (e) { console.error(`  ✗ ${m.from} → ${m.to}: ${e.message?.slice(0,140)}`); break; }
    all.push(...(data.meetings ?? []));
    next_page_token = data.next_page_token ?? "";
    if (!next_page_token) break;
  }
}

console.log(`Total recordings de Florian (sept-25 → hoy): ${all.length}\n`);

// Filtrar por topic con "fernanda"
const fern = all.filter(m => /fernanda/i.test(m.topic ?? ""));
fern.sort((a,b) => (a.start_time??"").localeCompare(b.start_time??""));

console.log(`══════════ Recordings con "Fernanda" en el topic ══════════`);
let pre = 0, post = 0;
for (const m of fern) {
  const start = m.start_time ?? "?";
  const day = start.slice(0,10);
  const isPre = day < "2026-02-17";
  if (isPre) pre++; else post++;
  console.log(`  ${start.slice(0,16)}  ${String(m.duration ?? 0).padStart(3)}min  ${isPre?"🔴 PRE":"✓ post"}  topic="${(m.topic??"").slice(0,50)}"  id=${m.id}`);
}
console.log(`\nTotal: ${fern.length}  (pre-17feb: ${pre} · post: ${post})`);

// Topics distintos para ayudar a identificar otros patrones
console.log(`\n══════════ Top 15 topics distintos de Florian ══════════`);
const topics = new Map();
for (const m of all) topics.set(m.topic, (topics.get(m.topic)??0)+1);
for (const [t,n] of [...topics.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log(`  x${String(n).padStart(3)}  ${t}`);
}
