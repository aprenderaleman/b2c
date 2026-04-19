#!/usr/bin/env node
/**
 * READ-ONLY recon of every past Zoom instance for the 6 recurring meetings
 * that feed the LMS. Produces:
 *   1. A per-class table (date, duration, billed_hours, teacher, attendees)
 *   2. Per-student rollup (total sessions consumed, split by group)
 *   3. Per-teacher rollup (hours worked, grouped by month + class type → €)
 *
 * Writes NOTHING to Supabase. Gelfis reviews the numbers before we backfill.
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

// Duration rule (business policy by Gelfis)
function billedHours(minutes) {
  if (minutes < 45)  return 0;
  if (minutes <= 90) return 1;
  return 2;
}

// --- tokens + helpers
const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const { access_token: token } = await (await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
)).json();

async function zget(path) {
  const r = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}

// --- Supabase: load our 13 students + 3 teachers with emails for matching
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: allUsers } = await db.query(`
  SELECT u.id, u.email, u.full_name, u.role
    FROM users u
   WHERE u.role IN ('student', 'teacher')`);
await db.end();

const userByEmail = new Map(allUsers.map(u => [u.email.toLowerCase(), u]));

// Also accept the legacy typo email for Maria Eugenia
const mariaEugeniaRow = userByEmail.get("mariupp2016@gmail.com");
if (mariaEugeniaRow) userByEmail.set("mariupp@2016.com", mariaEugeniaRow);

// ----------------------------------------------------------------------------
// Accumulators
// ----------------------------------------------------------------------------
const perStudent = new Map();   // email → { name, total_sessions, byMeeting: Map }
const perTeacher = new Map();   // teacher_email → Map(month → { hours, classes, class_type })
const perMeeting = [];          // for printing individual events

for (const meeting of MEETINGS) {
  console.log(`\n════════ ${meeting.label}  (zoom ${meeting.zoom_id}) ════════`);

  let instances;
  try {
    const res = await zget(`/past_meetings/${meeting.zoom_id}/instances`);
    instances = res.meetings ?? [];
  } catch (e) {
    console.log(`  ✗ couldn't list instances: ${e.message}`);
    continue;
  }
  console.log(`  past instances: ${instances.length}`);
  if (instances.length === 0) continue;

  const summaryRows = [];

  for (const inst of instances) {
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
    const date = det.start_time?.slice(0, 10);

    // Attendees that match our users
    const matched = [];
    for (const p of participants) {
      const e = (p.user_email ?? "").toLowerCase();
      if (!e) continue;
      if (userByEmail.has(e)) matched.push(userByEmail.get(e));
    }

    summaryRows.push({ date, start: det.start_time, mins, billed: bh, participants: matched, raw_participants: participants });

    // ---- Accumulate student consumption
    if (bh > 0) {
      for (const u of matched) {
        if (u.role !== "student") continue;
        if (!perStudent.has(u.email)) perStudent.set(u.email, { name: u.full_name, total: 0, byMeeting: new Map() });
        const s = perStudent.get(u.email);
        s.total += 1;
        s.byMeeting.set(meeting.label, (s.byMeeting.get(meeting.label) ?? 0) + 1);
      }
    }

    // ---- Accumulate teacher earnings (ONLY if their email was actually in the meeting)
    if (bh > 0 && meeting.teacher_email) {
      const teacherPresent = matched.some(u => u.role === "teacher" && u.email === meeting.teacher_email);
      if (teacherPresent) {
        const month = date.slice(0,7);  // "YYYY-MM"
        if (!perTeacher.has(meeting.teacher_email)) perTeacher.set(meeting.teacher_email, new Map());
        const m = perTeacher.get(meeting.teacher_email);
        const key = `${month}__${meeting.class_type}`;
        const cur = m.get(key) ?? { month, class_type: meeting.class_type, hours: 0, classes: 0 };
        cur.hours   += bh;
        cur.classes += 1;
        m.set(key, cur);
      }
    }
  }

  // ---- Print this meeting's table
  summaryRows.sort((a,b) => a.start.localeCompare(b.start));
  for (const r of summaryRows) {
    const who = r.participants.length === 0
      ? `(no matches — raw: ${r.raw_participants.map(p => p.user_email).filter(Boolean).slice(0,3).join(", ")})`
      : r.participants.map(p => p.full_name + (p.role === "teacher" ? "†" : "")).join(", ");
    console.log(`  ${r.date}  ${String(r.mins).padStart(3)}min → billed=${r.billed}h  attended: ${who}`);
  }
  perMeeting.push({ meeting, rows: summaryRows });
}

// ============================================================================
// Rollups
// ============================================================================
console.log("\n\n════════ STUDENT CONSUMPTION ════════");
const studSorted = [...perStudent.entries()].sort((a,b) => b[1].total - a[1].total);
for (const [email, s] of studSorted) {
  const breakdown = [...s.byMeeting.entries()].map(([m,n]) => `${n}× ${m}`).join(" | ");
  console.log(`  ${s.name.padEnd(28)} ${s.total} sesiones  (${breakdown})`);
}
console.log(`\n  (Students with 0 past sessions in these 6 meetings: ${
  allUsers.filter(u => u.role === "student").length - perStudent.size
})`);

console.log("\n\n════════ TEACHER EARNINGS (retroactive) ════════");
const RATE = {
  "coyotemoonyoga@gmail.com":  { group: 1700, individual: 1500 },  // Sabine
  "florian.zormann@gmx.at":    { group: 1700, individual: 1500 },  // Florian
  "nicaemila2211@gmail.com":   { group: 2000, individual: 1700 },  // Veronica
};
for (const [email, monthMap] of perTeacher) {
  const name = allUsers.find(u => u.email === email)?.full_name ?? email;
  console.log(`\n  ── ${name} (${email}) ──`);
  let grandTotal = 0;
  const byMonth = new Map();
  for (const { month, class_type, hours, classes } of monthMap.values()) {
    const rate = RATE[email][class_type];
    const amount = hours * rate;
    grandTotal += amount;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({ class_type, hours, classes, rate, amount });
  }
  const months = [...byMonth.keys()].sort();
  for (const m of months) {
    let monthTotal = 0;
    console.log(`    ${m}:`);
    for (const r of byMonth.get(m)) {
      console.log(`      ${r.class_type.padEnd(10)}  ${r.classes} clases · ${r.hours}h · ${r.rate/100}€/h  = ${r.amount/100}€`);
      monthTotal += r.amount;
    }
    console.log(`      ────────────────────────── total mes: ${monthTotal/100}€`);
  }
  console.log(`    ══════════════════════════════ TOTAL ADEUDADO: ${grandTotal/100}€`);
}
