#!/usr/bin/env node
/**
 * Busca TODAS las reuniones pasadas del host Florian Zormann que tengan
 * a Fernanda como participante, sin importar el meeting_id. Cubre el
 * caso "pre-plataforma": clases que existieron en Zoom antes de que el
 * meeting recurrente actual (85833907996) se creara.
 *
 * Endpoint Zoom: /report/users/{userId}/meetings ofrece hasta 12 meses
 * atrás en chunks de 1 mes.
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
  if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}
function encUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

// 1. Resolver userId de Florian
const florian = await zget(`/users/${FLORIAN_EMAIL}`);
console.log(`Host: ${florian.first_name} ${florian.last_name} (id=${florian.id})  type=${florian.type}\n`);

// 2. Recorrer mes a mes desde hoy hacia atrás
const startMonth = new Date("2025-09-01T00:00:00Z");  // ~8 meses antes del primer match (feb-26)
const today = new Date();
const months = [];
const cur = new Date(startMonth);
while (cur < today) {
  const next = new Date(cur);
  next.setUTCMonth(next.getUTCMonth() + 1);
  months.push({ from: cur.toISOString().slice(0,10), to: new Date(Math.min(next.getTime() - 86400_000, today.getTime())).toISOString().slice(0,10) });
  cur.setUTCMonth(cur.getUTCMonth() + 1);
}

const candidates = [];   // todas las reuniones del host
for (const m of months) {
  let nextPageToken = "";
  let pages = 0;
  do {
    pages++;
    const path = `/report/users/${florian.id}/meetings?from=${m.from}&to=${m.to}&page_size=300${nextPageToken ? `&next_page_token=${encodeURIComponent(nextPageToken)}` : ""}`;
    try {
      const data = await zget(path);
      candidates.push(...(data.meetings ?? []));
      nextPageToken = data.next_page_token ?? "";
    } catch (e) {
      console.error(`  ✗ ${m.from} → ${m.to}: ${e.message?.slice(0,140)}`);
      break;
    }
  } while (nextPageToken && pages < 5);
}
console.log(`Total reuniones pasadas de Florian (sept-25 → hoy): ${candidates.length}`);

// 3. Filtrar por nombre/topic con "fernanda" o duración >30min y revisar participantes
const interestingByTopic = candidates.filter(m => /fernanda/i.test(m.topic ?? ""));
console.log(`Con "fernanda" en el topic: ${interestingByTopic.length}\n`);

// 4. Para cada reunión potencialmente relevante, traer participantes
//    (filtramos también por duración ≥30min para descartar tests)
const relevant = candidates.filter(m => (m.duration ?? 0) >= 30);
console.log(`Reuniones de Florian ≥30min: ${relevant.length}`);
console.log(`Buscando a Fernanda como participante en cada una…\n`);

const matches = [];
let scanned = 0;
for (const m of relevant) {
  scanned++;
  if (scanned % 25 === 0) process.stdout.write(`  ...${scanned}/${relevant.length}\n`);
  try {
    const p = await zget(`/report/meetings/${encUuid(m.uuid)}/participants?page_size=200`);
    const parts = p.participants ?? [];
    const found = parts.find(person => {
      const e = (person.user_email || "").toLowerCase();
      const n = (person.name || "").toLowerCase();
      return e.includes("fernanda") || e.includes("keller") || n.includes("fernanda") || n.includes("keller");
    });
    if (found) {
      matches.push({
        start: m.start_time, durationMin: m.duration, topic: m.topic, id: m.id,
        participantName: found.name, participantEmail: found.user_email,
      });
    }
  } catch (e) {
    if (!String(e.message).includes("3001"))   // 3001 = report not ready (low-frequency meetings)
      console.error(`    ✗ ${m.start_time} ${m.id}: ${e.message?.slice(0,80)}`);
  }
}
matches.sort((a,b) => a.start.localeCompare(b.start));

console.log(`\n══════════ MATCHES con Fernanda ══════════`);
let pre = 0, post = 0;
for (const x of matches) {
  const day = x.start.slice(0,10);
  const isPre = day < "2026-02-17";
  if (isPre) pre++; else post++;
  console.log(`  ${x.start.slice(0,16)}  ${String(x.durationMin).padStart(3)}min  ${isPre ? "🔴 PRE" : "✓ post"}  topic="${(x.topic??"").slice(0,40)}"  participant=${x.participantName} <${x.participantEmail||"—"}>`);
}
console.log(`\nTotal con Fernanda: ${matches.length}  (pre-17feb: ${pre} · 17feb+: ${post})`);
