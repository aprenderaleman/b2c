#!/usr/bin/env node
/**
 * READ-ONLY: lista cada instancia de Zoom de abril 2026 para los 6 meetings
 * recurrentes, calcula horas facturables y los € que tocan a cada profesor.
 *
 * NO escribe nada. Solo imprime el resumen para que Gelfis valide antes
 * de correr el backfill + rollup contra la DB.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");

const ACCOUNT_ID    = "DUPrhOnvSZ29OrQ0VoDr-w";
const CLIENT_ID     = "lDvwsk8ET_eO8f3U23Tuvg";
const CLIENT_SECRET = "orqfBl9ZQa8fOE4FND7CMVD9IjiJfE5n";

const TARGET_MONTH = "2026-04";   // YYYY-MM

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const MEETINGS = [
  { zoom_id: "81635585039", label: "Deutsch A1 – B1 Morgens", teacher_email: "coyotemoonyoga@gmail.com", class_type: "group"      },
  { zoom_id: "87432991646", label: "Ayman Kayali",            teacher_email: "nicaemila2211@gmail.com",  class_type: "individual" },
  { zoom_id: "84238102027", label: "Deutsch A1 Abends",       teacher_email: "florian.zormann@gmx.at",   class_type: "group"      },
  { zoom_id: "85833907996", label: "Fernanda VIP",            teacher_email: "florian.zormann@gmx.at",   class_type: "individual" },
  { zoom_id: "81802815059", label: "Maria Eugenia VIP",       teacher_email: "coyotemoonyoga@gmail.com", class_type: "individual" },
  { zoom_id: "86393586961", label: "A1.2 Nachmittags (dead)", teacher_email: null,                        class_type: "group"      },
];

function billedHours(min) {
  if (min < 45)  return 0;
  if (min <= 90) return 1;
  return 2;
}

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
);
if (!tokRes.ok) {
  console.error("✗ Zoom OAuth failed:", tokRes.status, await tokRes.text());
  process.exit(1);
}
const { access_token: token } = await tokRes.json();

async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

// Cargar usuarios + tarifas + clases ya backfilleadas para detectar duplicados.
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: allUsers } = await db.query(`
  SELECT u.id, LOWER(u.email) AS email, u.full_name, u.role
    FROM users u
   WHERE u.role IN ('student', 'teacher')`);
const userByEmail = new Map(allUsers.map(u => [u.email, u]));
const mariaEugenia = userByEmail.get("mariupp2016@gmail.com");
if (mariaEugenia) userByEmail.set("mariupp@2016.com", mariaEugenia);

const { rows: teacherRates } = await db.query(`
  SELECT LOWER(u.email) AS email, t.rate_group_cents, t.rate_individual_cents, t.currency
    FROM teachers t JOIN users u ON u.id = t.user_id`);
const RATE = new Map(teacherRates.map(t => [t.email, {
  group: t.rate_group_cents, individual: t.rate_individual_cents, currency: t.currency,
}]));

const { rows: existing } = await db.query(`
  SELECT notes_admin FROM classes
   WHERE notes_admin LIKE 'zoom_uuid=%'
     AND scheduled_at >= '2026-04-01' AND scheduled_at < '2026-05-01'`);
const alreadyBackfilled = new Set(existing.map(r => r.notes_admin.replace(/^zoom_uuid=/, "")));
await db.end();

// Acumuladores (solo abril 2026)
const perStudent = new Map();
const perTeacher = new Map();
const perMeetingDetail = [];

for (const meeting of MEETINGS) {
  console.log(`\n════════ ${meeting.label}  (zoom ${meeting.zoom_id}) ════════`);

  let instances;
  try {
    const res = await zget(`/past_meetings/${meeting.zoom_id}/instances`);
    instances = res.meetings ?? [];
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    continue;
  }

  // Filtrar solo abril 2026
  const aprilInstances = instances.filter(i => (i.start_time ?? "").startsWith(TARGET_MONTH));
  console.log(`  instancias en ${TARGET_MONTH}: ${aprilInstances.length} (de ${instances.length} totales)`);
  if (aprilInstances.length === 0) continue;

  const rows = [];
  for (const inst of aprilInstances) {
    const uuid = encodeUuid(inst.uuid);
    let det, participants;
    try {
      det = await zget(`/past_meetings/${uuid}`);
      const p = await zget(`/past_meetings/${uuid}/participants?page_size=100`);
      participants = p.participants ?? [];
    } catch (e) {
      console.log(`  ✗ ${inst.start_time} fetch err: ${e.message}`);
      continue;
    }

    const mins = det.duration ?? 0;
    const bh   = billedHours(mins);
    const date = (det.start_time ?? "").slice(0, 10);
    const inDb = alreadyBackfilled.has(inst.uuid);

    const matched = [];
    for (const p of participants) {
      const e = (p.user_email ?? "").toLowerCase();
      if (e && userByEmail.has(e)) matched.push(userByEmail.get(e));
    }

    rows.push({
      uuid: inst.uuid, date, start: det.start_time, mins, billed: bh,
      participants: matched, raw_participants: participants, inDb,
    });

    if (bh > 0) {
      for (const u of matched) {
        if (u.role !== "student") continue;
        if (!perStudent.has(u.email)) perStudent.set(u.email, { name: u.full_name, total: 0, byMeeting: new Map() });
        const s = perStudent.get(u.email);
        s.total += 1;
        s.byMeeting.set(meeting.label, (s.byMeeting.get(meeting.label) ?? 0) + 1);
      }
    }

    if (bh > 0 && meeting.teacher_email) {
      const teacherPresent = matched.some(u => u.role === "teacher" && u.email === meeting.teacher_email);
      // Importante: aunque la profe no aparezca en participantes (a veces se loguea con otro email),
      // si el meeting es suyo le acreditamos las horas. Marcamos los casos sospechosos.
      const credit = teacherPresent || true;  // siempre acreditar al dueño del meeting
      if (credit) {
        if (!perTeacher.has(meeting.teacher_email)) perTeacher.set(meeting.teacher_email, []);
        perTeacher.get(meeting.teacher_email).push({
          date, mins, billed: bh, class_type: meeting.class_type, label: meeting.label,
          teacherInZoomList: teacherPresent,
        });
      }
    }
  }

  rows.sort((a,b) => a.start.localeCompare(b.start));
  for (const r of rows) {
    const flag = r.inDb ? "✓DB" : "  ⚠ NUEVO";
    const who = r.participants.length === 0
      ? `(sin matches — raw: ${r.raw_participants.map(p => p.user_email).filter(Boolean).slice(0,3).join(", ") || "—"})`
      : r.participants.map(p => p.full_name + (p.role === "teacher" ? "†" : "")).join(", ");
    console.log(`  ${flag}  ${r.date}  ${String(r.mins).padStart(3)}min → bh=${r.billed}h  ${who}`);
  }
  perMeetingDetail.push({ meeting, rows });
}

// ============================================================================
console.log("\n\n════════ CONSUMO DE ESTUDIANTES — abril 2026 ════════");
const studSorted = [...perStudent.entries()].sort((a,b) => b[1].total - a[1].total);
for (const [, s] of studSorted) {
  const breakdown = [...s.byMeeting.entries()].map(([m,n]) => `${n}× ${m}`).join(" | ");
  console.log(`  ${(s.name ?? "—").padEnd(28)} ${s.total} sesiones  (${breakdown})`);
}
if (studSorted.length === 0) console.log("  (sin sesiones registradas)");

console.log("\n\n════════ NÓMINA DE PROFESORES — abril 2026 (a pagar) ════════");
let grandTotalCents = 0;
for (const [email, sessions] of perTeacher) {
  const name = allUsers.find(u => u.email === email)?.full_name ?? email;
  const rate = RATE.get(email);
  if (!rate) {
    console.log(`\n  ── ${name} (${email}) — ✗ no rate found in teachers table`);
    continue;
  }
  console.log(`\n  ── ${name} (${email}) ──`);

  // Agrupar por class_type
  const byType = new Map();
  for (const s of sessions) {
    if (s.billed === 0) continue;
    if (!byType.has(s.class_type)) byType.set(s.class_type, { hours: 0, classes: 0, sessions: [] });
    const cur = byType.get(s.class_type);
    cur.hours += s.billed;
    cur.classes += 1;
    cur.sessions.push(s);
  }

  let teacherTotal = 0;
  for (const [type, info] of byType) {
    const rateCents = type === "individual" ? rate.individual : rate.group;
    const amount = info.hours * rateCents;
    teacherTotal += amount;
    console.log(`    ${type.padEnd(10)} ${info.classes} clases · ${info.hours}h · ${rateCents/100}€/h = ${amount/100}€`);
    for (const s of info.sessions) {
      const flag = s.teacherInZoomList ? "  " : "  ⚠ profe no apareció en lista de Zoom";
      console.log(`        ${s.date}  ${s.mins}min  bh=${s.billed}h  (${s.label})${flag}`);
    }
  }
  console.log(`    ────────────────────────  TOTAL: ${teacherTotal/100}€ ${rate.currency}`);
  grandTotalCents += teacherTotal;
}
console.log(`\n  ════════════════════════════════════════════════`);
console.log(`  TOTAL NÓMINA ABRIL 2026:  ${grandTotalCents/100}€`);
console.log(`  ════════════════════════════════════════════════`);

// Resumen DB vs Zoom
const totalZoom = perMeetingDetail.reduce((n, m) => n + m.rows.length, 0);
const totalNew  = perMeetingDetail.reduce((n, m) => n + m.rows.filter(r => !r.inDb).length, 0);
console.log(`\n  Estado DB: ${totalZoom - totalNew}/${totalZoom} ya en classes, ${totalNew} pendientes de backfill`);
