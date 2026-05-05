// Verifica con la API de Zoom qué clases de cada alumno son REALES
// (apareció en la grabación) vs FANTASMA (backfill sin presencia).
// Saca la fecha de la primera clase real → "fecha de inicio efectiva".

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

// Zoom OAuth (mismas credenciales que zoom_past_recon.mjs)
const ZOOM = {
  ACCOUNT_ID:    "DUPrhOnvSZ29OrQ0VoDr-w",
  CLIENT_ID:     "lDvwsk8ET_eO8f3U23Tuvg",
  CLIENT_SECRET: "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n",
};
async function getToken() {
  const basic = Buffer.from(`${ZOOM.CLIENT_ID}:${ZOOM.CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM.ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  const j = await r.json();
  return j.access_token;
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

const TOKEN = await getToken();
console.log("✓ token Zoom OK\n");

// Cache de participantes por UUID (varios alumnos comparten clases)
const cache = new Map();
async function getParticipants(uuid) {
  if (cache.has(uuid)) return cache.get(uuid);
  const enc = encodeUuid(uuid);
  let all = [];
  let token = "";
  for (;;) {
    const url = `https://api.zoom.us/v2/past_meetings/${enc}/participants?page_size=100${token ? `&next_page_token=${token}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) {
      const txt = await r.text();
      cache.set(uuid, { error: `${r.status} ${txt.slice(0,80)}`, list: [] });
      return cache.get(uuid);
    }
    const j = await r.json();
    all = all.concat(j.participants ?? []);
    token = j.next_page_token;
    if (!token) break;
  }
  cache.set(uuid, { error: null, list: all });
  return cache.get(uuid);
}

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").trim();
}
function matchesAlumno(participant, alumno) {
  const email = (participant.user_email || "").toLowerCase().trim();
  if (email && email === alumno.email.toLowerCase()) return "email_exact";
  const pName = normalize(participant.name);
  const aName = normalize(alumno.name);
  if (!pName || !aName) return null;
  // Aliases declarados explícitamente en el perfil del alumno
  for (const alias of (alumno.aliases ?? [])) {
    const a = normalize(alias);
    if (a && pName.includes(a)) return `alias:${alias}`;
  }
  // Cualquier "token" del nombre del alumno ≥4 chars que aparezca en el del participante
  const aTokens = aName.split(" ").filter(t => t.length >= 4);
  for (const t of aTokens) if (pName.includes(t)) return `name:${t}`;
  return null;
}

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const ALUMNOS = [
  { name: "Javier Esqueta",   email: "javiesqueta2203@gmail.com" },
  { name: "Victoria",         email: "victoriaavilesgonzalez@gmail.com",
    // Aparece en Zoom como "Vicky" (sin email).
    aliases: ["vicky", "vicki"] },
  { name: "Maria Eugenia",    email: "mariupp2016@gmail.com",
    aliases: ["maria eugenia", "mariu"] },
  { name: "Ayman Kayali",     email: "ayman.kayali.lucena@gmail.com" },
  { name: "Luis Emilio",      email: "viverosluisemilio@gmail.com",
    aliases: ["emilio", "viveros"] },
  { name: "Francisco",        email: "catalan_640@hotmail.com",
    aliases: ["francisco", "paco", "fran"] },
];

const summary = [];

for (const alumno of ALUMNOS) {
  console.log(`\n══════════════ ${alumno.name} <${alumno.email}> ══════════════`);

  const { rows: stu } = await c.query(`
    SELECT s.id, s.classes_purchased, s.classes_adjustment
      FROM students s JOIN users u ON u.id=s.user_id
     WHERE u.email = $1`, [alumno.email]);
  if (stu.length === 0) { console.log("  no encontrado"); continue; }
  const studentId = stu[0].id;
  const planTotal = Number(stu[0].classes_purchased) + Number(stu[0].classes_adjustment ?? 0);

  // Pillamos TODAS sus clases con zoom_uuid (notes_admin contiene "zoom_uuid=...")
  const { rows: classes } = await c.query(`
    SELECT cp.class_id, c.scheduled_at, c.duration_minutes, c.actual_duration_minutes,
           c.status, c.billed_hours, c.title, c.notes_admin, c.created_at,
           cp.attended, cp.counts_as_session
      FROM class_participants cp
      JOIN classes c ON c.id = cp.class_id
     WHERE cp.student_id = $1
     ORDER BY c.scheduled_at`, [studentId]);

  let realClases = [];
  let phantomClases = [];
  let noZoom = [];

  for (const k of classes) {
    if (k.status !== "completed") continue;
    const m = (k.notes_admin || "").match(/zoom_uuid=([^\s,;]+)/);
    if (!m) {
      noZoom.push(k);
      continue;
    }
    const uuid = m[1];
    const { error, list } = await getParticipants(uuid);
    if (error) {
      console.log(`  ⚠ ${k.scheduled_at.toISOString().slice(0,10)} uuid=${uuid.slice(0,12)}… → ${error}`);
      continue;
    }
    let match = null;
    for (const p of list) { match = matchesAlumno(p, alumno); if (match) break; }
    if (match) realClases.push({ ...k, _match: match });
    else        phantomClases.push({ ...k, _participants: list.length });
  }

  // Ordenar
  realClases.sort((a,b)=>a.scheduled_at - b.scheduled_at);
  phantomClases.sort((a,b)=>a.scheduled_at - b.scheduled_at);

  console.log(`  Total clases con zoom_uuid procesadas: ${realClases.length + phantomClases.length}`);
  console.log(`  ✓ REALES (apareció en Zoom): ${realClases.length}`);
  console.log(`  ✗ FANTASMA (no estaba en Zoom): ${phantomClases.length}`);
  if (noZoom.length) console.log(`  · sin zoom_uuid: ${noZoom.length}`);

  if (realClases.length > 0) {
    const first = realClases[0];
    const last  = realClases[realClases.length-1];
    console.log(`  Primera clase REAL: ${first.scheduled_at.toISOString().slice(0,10)} (match=${first._match})`);
    console.log(`  Última clase REAL : ${last.scheduled_at.toISOString().slice(0,10)}`);
  }
  console.log(`  Fantasmas detalladas:`);
  for (const f of phantomClases) {
    console.log(`    - ${f.scheduled_at.toISOString().slice(0,10)} bill=${f.billed_hours} att=${f.attended} (${f._participants} en Zoom) | ${f.title?.slice(0,40)}`);
  }

  // Cómputo de consumo real
  const realBilled    = realClases.reduce((s,r)=> s + (r.counts_as_session && r.billed_hours > 0 ? Number(r.billed_hours) : 0), 0);
  const phantomBilled = phantomClases.reduce((s,r)=> s + (r.counts_as_session && r.billed_hours > 0 ? Number(r.billed_hours) : 0), 0);
  // Los noZoom (sin zoom_uuid) son normalmente futuras; no las contamos
  const consumedReal  = realBilled;
  const remainingReal = planTotal - consumedReal;

  console.log(`  Plan: ${planTotal} | Consumo REAL (verificado en Zoom): ${consumedReal} | RESTAN: ${remainingReal}`);

  summary.push({
    name:           alumno.name,
    email:          alumno.email,
    plan:           planTotal,
    realSessions:   realClases.length,
    phantomSessions:phantomClases.length,
    realBilled:     consumedReal,
    phantomBilled:  phantomBilled,
    remainingReal:  remainingReal,
    firstReal:      realClases[0]?.scheduled_at?.toISOString().slice(0,10) ?? null,
    lastReal:       realClases[realClases.length-1]?.scheduled_at?.toISOString().slice(0,10) ?? null,
  });
}

console.log("\n\n═══════════════════════ RESUMEN ═══════════════════════");
console.log("Alumno              | Plan | Real✓ | Fantasma✗ | bill_real | bill_fantasma | RESTAN | 1ª real    → última");
for (const s of summary) {
  console.log(
    s.name.padEnd(20) + "|" +
    String(s.plan).padStart(5) + " |" +
    String(s.realSessions).padStart(6) + " |" +
    String(s.phantomSessions).padStart(10) + " |" +
    String(s.realBilled).padStart(10) + " |" +
    String(s.phantomBilled).padStart(14) + " |" +
    String(s.remainingReal).padStart(7) + " | " +
    (s.firstReal ?? "—".padEnd(10)) + " → " + (s.lastReal ?? "—")
  );
}

await c.end();
