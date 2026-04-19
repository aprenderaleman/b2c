#!/usr/bin/env node
/**
 * Backfill historical classes from Zoom into Supabase.
 *
 * Policy (per Gelfis):
 *   - A past Zoom instance counts as a real class iff duration ≥ 45 min.
 *     45-90 min → billed_hours=1, >90 min → billed_hours=2.
 *   - Group members: every current member of the group is recorded as
 *     attended=TRUE and counts_as_session=TRUE (option (b)), regardless
 *     of whether they appeared in the Zoom participant list (because many
 *     join as guests without logging in). pack_started_at acts as the
 *     lower bound — classes before a student's pack_started_at are skipped.
 *   - Nachmittags is deleted; Nicolas gets credited for its valid past
 *     classes. The teacher field stays NULL (Martin Bielke was paid
 *     out-of-band and isn't in this system).
 *
 * Runs inside a single txn; idempotent via ON CONFLICT on a synthetic
 * "zoom_uuid" stored in classes.notes_admin so re-running won't double-seed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg    = require("pg");
const mysql = require("mysql2/promise");

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

// Map the 5 live Zoom meetings to our groups.
const MEETINGS = [
  { zoom_id: "81635585039", group_name: "Deutsch A1 – B1 Morgens",                         class_type: "group"      },
  { zoom_id: "87432991646", group_name: "Ayman Kayali I Aprender-Aleman.de",               class_type: "individual" },
  { zoom_id: "84238102027", group_name: "Deutsch A1 Abends ",                              class_type: "group"      },
  { zoom_id: "85833907996", group_name: "Fernanda - VIP ",                                 class_type: "individual" },
  { zoom_id: "81802815059", group_name: "Maria Eugenia - Deutsch B1 I Aprender-Aleman.de", class_type: "individual" },
];

const NACHMITTAGS_ZOOM_ID = "86393586961";

function billedHours(min) {
  if (min < 45)  return 0;
  if (min <= 90) return 1;
  return 2;
}

// --- auth
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

// --- DB
const legacy = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");

// ============================================================================
// 1) Update pack_started_at from legacy.users.createdAt
// ============================================================================
const STUDENT_EMAILS = [
  "ahlamsaloui7@gmail.com","xela_cigales@hotmail.es","ayman.kayali.lucena@gmail.com",
  "ferkeller26@gmail.com","mariupp2016@gmail.com","alejokxito@hotmail.com",
  "javiesqueta2203@gmail.com","viverosluisemilio@gmail.com","lydia_mendoza@hotmail.com",
  "carraasco.nico18@gmail.com","victoriaavilesgonzalez@gmail.com","catalan_640@hotmail.com",
  "natalia.paniagua.casas@gmail.com",
];
// Legacy-side emails include the typo for Maria Eugenia
const LEGACY_EMAILS = STUDENT_EMAILS.map(e => e === "mariupp2016@gmail.com" ? "mariupp@2016.com" : e);

const [legacyRows] = await legacy.query(
  `SELECT LOWER(email) AS email, createdAt FROM users
    WHERE LOWER(email) IN (${LEGACY_EMAILS.map(() => '?').join(',')})`,
  LEGACY_EMAILS,
);
console.log(`\n── updating pack_started_at from legacy.createdAt (${legacyRows.length} users) ──`);
for (const lu of legacyRows) {
  const d = lu.createdAt.toISOString().slice(0, 10);
  // Map legacy typo email → corrected email
  const newEmail = lu.email === "mariupp@2016.com" ? "mariupp2016@gmail.com" : lu.email;
  const r = await db.query(
    `UPDATE students
        SET pack_started_at = $1::date,
            pack_expires_at = ($1::date + INTERVAL '6 months')::date
       FROM users u
      WHERE students.user_id = u.id AND LOWER(u.email) = LOWER($2)`,
    [d, newEmail],
  );
  console.log(`  ${newEmail.padEnd(36)} → pack_started_at=${d}  (${r.rowCount} row)`);
}

// ============================================================================
// 2) Backfill the 5 live groups
// ============================================================================

async function classAlreadyBackfilled(zoomUuid) {
  const r = await db.query(`SELECT 1 FROM classes WHERE notes_admin = $1 LIMIT 1`, [`zoom_uuid=${zoomUuid}`]);
  return r.rowCount > 0;
}

let totalClasses = 0, totalParticipants = 0;

for (const meeting of MEETINGS) {
  const { rows: [g] } = await db.query(
    `SELECT id, teacher_id, name FROM student_groups WHERE name = $1`,
    [meeting.group_name],
  );
  if (!g) { console.log(`\n✗ group not found: ${meeting.group_name}`); continue; }

  const { rows: members } = await db.query(
    `SELECT s.id AS student_id, s.pack_started_at, u.full_name
       FROM student_group_members m
       JOIN students s ON s.id = m.student_id
       JOIN users u    ON u.id = s.user_id
      WHERE m.group_id = $1
      ORDER BY u.full_name`,
    [g.id],
  );

  console.log(`\n── ${g.name}  (group_id=${g.id}, ${members.length} members) ──`);

  let instances;
  try {
    const res = await zget(`/past_meetings/${meeting.zoom_id}/instances`);
    instances = res.meetings ?? [];
  } catch (e) {
    console.log(`  ✗ ${e.message}`); continue;
  }

  for (const inst of instances) {
    if (await classAlreadyBackfilled(inst.uuid)) continue;

    const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
    const minutes = det.duration ?? 0;
    const bh = billedHours(minutes);
    if (bh === 0) continue;

    // Insert class
    const startedAt = det.start_time;
    const endedAt   = det.end_time;
    const { rows: [cls] } = await db.query(
      `INSERT INTO classes
          (type, teacher_id, group_id, scheduled_at, duration_minutes,
           title, status, started_at, ended_at, actual_duration_minutes,
           billed_hours, notes_admin)
       VALUES ($1::class_type, $2, $3, $4, $5,
               $6, 'completed', $4, $7, $5,
               $8, $9)
       RETURNING id`,
      [meeting.class_type, g.teacher_id, g.id, startedAt, minutes,
       g.name, endedAt, bh, `zoom_uuid=${inst.uuid}`],
    );
    totalClasses++;

    // Add every eligible member as attended
    let participantCount = 0;
    for (const mem of members) {
      if (mem.pack_started_at && new Date(mem.pack_started_at) > new Date(startedAt)) continue;
      await db.query(
        `INSERT INTO class_participants
            (class_id, student_id, attended, counts_as_session, minutes_attended)
         VALUES ($1, $2, TRUE, TRUE, $3)
         ON CONFLICT DO NOTHING`,
        [cls.id, mem.student_id, minutes],
      );
      participantCount++;
      totalParticipants++;
    }
    console.log(`  + ${startedAt.slice(0,10)}  ${minutes}min  bh=${bh}h  participants=${participantCount}`);
  }
}

// ============================================================================
// 3) Nachmittags — Nicolas only, teacher_id NULL
// ============================================================================
const { rows: [nicolas] } = await db.query(`
  SELECT s.id AS student_id, s.pack_started_at
    FROM students s JOIN users u ON u.id = s.user_id
   WHERE u.email = 'carraasco.nico18@gmail.com'`);
if (!nicolas) { console.log("✗ Nicolas not found"); }
else {
  console.log(`\n── Nachmittags backfill for Nicolas (student_id=${nicolas.student_id}) ──`);
  const res = await zget(`/past_meetings/${NACHMITTAGS_ZOOM_ID}/instances`);
  const instances = res.meetings ?? [];
  for (const inst of instances) {
    if (await classAlreadyBackfilled(inst.uuid)) continue;
    const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
    const minutes = det.duration ?? 0;
    const bh = billedHours(minutes);
    if (bh === 0) continue;
    if (nicolas.pack_started_at && new Date(nicolas.pack_started_at) > new Date(det.start_time)) continue;

    const { rows: [cls] } = await db.query(
      `INSERT INTO classes
          (type, teacher_id, group_id, scheduled_at, duration_minutes,
           title, status, started_at, ended_at, actual_duration_minutes,
           billed_hours, notes_admin)
       VALUES ('group', NULL, NULL, $1, $2,
               $3, 'completed', $1, $4, $2, $5, $6)
       RETURNING id`,
      [det.start_time, minutes, "Deutsch A1.2 Nachmittags (archivado)",
       det.end_time, bh, `zoom_uuid=${inst.uuid}`],
    );
    totalClasses++;
    await db.query(
      `INSERT INTO class_participants (class_id, student_id, attended, counts_as_session, minutes_attended)
       VALUES ($1, $2, TRUE, TRUE, $3) ON CONFLICT DO NOTHING`,
      [cls.id, nicolas.student_id, minutes],
    );
    totalParticipants++;
    console.log(`  + ${det.start_time.slice(0,10)}  ${minutes}min  bh=${bh}h  → Nicolas`);
  }
}

await db.query("COMMIT");
console.log(`\n✓ committed: ${totalClasses} classes, ${totalParticipants} participation rows`);

// ============================================================================
// 4) Verification — show student packs + April earnings
// ============================================================================
console.log("\n═══════ STUDENT PACKS (después del backfill) ═══════");
const { rows: packs } = await db.query(`
  SELECT full_name, classes_purchased, classes_consumed, classes_remaining,
         pack_started_at, pack_expires_at
    FROM v_student_packs ORDER BY full_name`);
for (const p of packs) {
  console.log(`  ${p.full_name.padEnd(24)} ${String(p.classes_consumed).padStart(3)}/${p.classes_purchased} · restan ${String(p.classes_remaining).padStart(2)} · ` +
              `pack ${p.pack_started_at ? p.pack_started_at.toISOString().slice(0,10) : '—'} → ${p.pack_expires_at ? p.pack_expires_at.toISOString().slice(0,10) : '—'}`);
}

console.log("\n═══════ TEACHER EARNINGS — TODOS LOS MESES ═══════");
const { rows: earn } = await db.query(`
  SELECT full_name, period_start, class_type, classes_count, hours_total, amount_cents
    FROM v_teacher_earnings
   ORDER BY full_name, period_start, class_type`);
let lastTeacher = null, monthTotal = 0, lastMonth = null, grandTotal = 0;
for (const e of earn) {
  const teacher = e.full_name;
  const month   = e.period_start.toISOString().slice(0,7);
  if (teacher !== lastTeacher) {
    if (lastTeacher !== null) console.log(`    ══ TOTAL ${lastTeacher}: ${grandTotal/100}€ ══`);
    console.log(`\n  • ${teacher}`);
    lastTeacher = teacher; grandTotal = 0; lastMonth = null;
  }
  if (month !== lastMonth) {
    console.log(`    ${month}:`);
    lastMonth = month;
  }
  console.log(`      ${e.class_type.padEnd(10)} ${e.classes_count} clases · ${e.hours_total}h → ${e.amount_cents/100}€`);
  grandTotal += e.amount_cents;
}
if (lastTeacher) console.log(`    ══ TOTAL ${lastTeacher}: ${grandTotal/100}€ ══`);

console.log("\n═══════ ABRIL PENDIENTE (a pagar fin de mes) ═══════");
const { rows: april } = await db.query(`
  SELECT full_name,
         SUM(hours_total) AS hours,
         SUM(amount_cents) AS cents
    FROM v_teacher_earnings
   WHERE period_start = '2026-04-01'
   GROUP BY full_name ORDER BY full_name`);
let aprilTotal = 0;
for (const a of april) {
  console.log(`  ${a.full_name.padEnd(20)} ${a.hours}h  → ${a.cents/100}€`);
  aprilTotal += Number(a.cents);
}
console.log(`  ──────────────────────────────────`);
console.log(`  TOTAL ABRIL:        ${aprilTotal/100}€`);

await legacy.end();
await db.end();
