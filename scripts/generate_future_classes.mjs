#!/usr/bin/env node
/**
 * Materialise every future Zoom occurrence into a `classes` row so students
 * and teachers see their calendar in the app. Uses the occurrence list
 * Zoom already provides — we don't compute recurrence ourselves.
 *
 * Each class gets:
 *   - scheduled_at from Zoom occurrence
 *   - duration_minutes from Zoom (fallback to 60 or 120 per meeting)
 *   - teacher_id + group_id from our student_groups row
 *   - livekit_room_id auto-generated (UNIQUE, UUID)
 *   - status = 'scheduled'
 *   - one class_participants row per current group member (attended = NULL
 *     until the class actually happens)
 *
 * Idempotent via notes_admin = "zoom_occurrence=<uuid>" — re-running skips.
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
  { zoom_id: "81635585039", group_name: "Deutsch A1 – B1 Morgens",                         class_type: "group",      default_duration: 120 },
  { zoom_id: "87432991646", group_name: "Ayman Kayali I Aprender-Aleman.de",               class_type: "individual", default_duration: 60  },
  { zoom_id: "84238102027", group_name: "Deutsch A1 Abends ",                              class_type: "group",      default_duration: 120 },
  { zoom_id: "85833907996", group_name: "Fernanda - VIP ",                                 class_type: "individual", default_duration: 60  },
];

// Zoom OAuth
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

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");

const NOW = new Date();
let totalClasses = 0, totalParticipations = 0, skippedExisting = 0;

for (const meeting of MEETINGS) {
  // Resolve group
  const { rows: [g] } = await db.query(
    `SELECT id, teacher_id, name FROM student_groups WHERE name = $1`,
    [meeting.group_name],
  );
  if (!g) { console.log(`✗ group not found: ${meeting.group_name}`); continue; }

  const { rows: members } = await db.query(
    `SELECT s.id AS student_id, s.pack_started_at, u.full_name
       FROM student_group_members m
       JOIN students s ON s.id = m.student_id
       JOIN users u    ON u.id = s.user_id
      WHERE m.group_id = $1 ORDER BY u.full_name`,
    [g.id],
  );

  console.log(`\n── ${g.name} — ${members.length} miembros ──`);

  // Pull meeting detail (includes occurrences)
  const det = await zget(`/meetings/${meeting.zoom_id}?show_previous_occurrences=false`);
  const occurrences = det.occurrences ?? [];
  const futureOccs = occurrences.filter(o => new Date(o.start_time) >= NOW);
  console.log(`  ocurrencias futuras: ${futureOccs.length}`);

  for (const occ of futureOccs) {
    const marker = `zoom_occurrence=${occ.occurrence_id ?? occ.start_time}`;
    // Idempotency check
    const exists = await db.query(`SELECT 1 FROM classes WHERE notes_admin = $1 LIMIT 1`, [marker]);
    if (exists.rowCount > 0) { skippedExisting++; continue; }

    const minutes = occ.duration ?? meeting.default_duration;
    const startedAt = occ.start_time;                     // ISO, UTC
    const endedAtMs = new Date(startedAt).getTime() + minutes * 60_000;
    const endedAt   = new Date(endedAtMs).toISOString();

    const { rows: [cls] } = await db.query(
      `INSERT INTO classes
          (type, teacher_id, group_id, scheduled_at, duration_minutes,
           title, topic, status, notes_admin)
       VALUES ($1::class_type, $2, $3, $4, $5,
               $6, NULL, 'scheduled', $7)
       RETURNING id, livekit_room_id`,
      [meeting.class_type, g.teacher_id, g.id, startedAt, minutes,
       g.name, marker],
    );
    totalClasses++;

    for (const mem of members) {
      // Skip if student's pack started after this class's date
      if (mem.pack_started_at && new Date(mem.pack_started_at) > new Date(startedAt)) continue;
      await db.query(
        `INSERT INTO class_participants (class_id, student_id, attended, counts_as_session)
         VALUES ($1, $2, NULL, TRUE)
         ON CONFLICT DO NOTHING`,
        [cls.id, mem.student_id],
      );
      totalParticipations++;
    }
  }
}

await db.query("COMMIT");

console.log(`\n✓ ${totalClasses} clases creadas, ${totalParticipations} participantes asignados`);
if (skippedExisting > 0) console.log(`  (${skippedExisting} ocurrencias ya existían — ignoradas)`);

// Verification: next class per group
console.log("\n── próxima clase por grupo ──");
const { rows: next } = await db.query(`
  SELECT sg.name AS grupo,
         c.scheduled_at,
         c.duration_minutes,
         (SELECT COUNT(*) FROM class_participants cp WHERE cp.class_id = c.id) AS alumnos
    FROM classes c
    JOIN student_groups sg ON sg.id = c.group_id
   WHERE c.status = 'scheduled' AND c.scheduled_at >= NOW()
   ORDER BY c.scheduled_at
   LIMIT 10`);
for (const r of next) {
  console.log(`  ${r.scheduled_at.toISOString().slice(0,16).replace('T',' ')}  ${r.duration_minutes}min  ${r.grupo.padEnd(40)} (${r.alumnos} alumnos)`);
}

await db.end();
