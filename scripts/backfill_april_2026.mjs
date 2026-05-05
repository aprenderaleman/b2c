#!/usr/bin/env node
/**
 * Backfill abril 2026 desde Zoom.
 *
 * Política (acordada con Gelfis 2026-04-27):
 *   - Regla de horas: <15min → 0h (no se factura), 15-90min → 1h, >90min → 2h.
 *   - Para clases grupales se acreditan TODOS los miembros actuales del grupo
 *     como counts_as_session=TRUE, asistieran o no a Zoom (el alumno consume
 *     paquete si la clase tuvo lugar).
 *   - Para clases individuales se acredita el único alumno del grupo.
 *   - Idempotente: notes_admin = "zoom_uuid=<uuid>" como llave única lógica.
 *   - Recalcula class_hours_log + teacher_earnings al final.
 *
 * Todo va en una transacción. Si algo falla, ROLLBACK.
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

const TARGET_MONTH = "2026-04";

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
  { zoom_id: "81635585039", group_name: "Deutsch A1 – B1 Morgens",                         class_type: "group"      },
  { zoom_id: "87432991646", group_name: "Ayman Kayali I Aprender-Aleman.de",               class_type: "individual" },
  { zoom_id: "84238102027", group_name: "Deutsch A1 - B1 Abends",                          class_type: "group"      },
  { zoom_id: "85833907996", group_name: "Fernanda - VIP ",                                 class_type: "individual" },
  { zoom_id: "81802815059", group_name: "Maria Eugenia - Deutsch B1 I Aprender-Aleman.de", class_type: "individual" },
];

function billedHours(min) {
  if (min < 15)  return 0;
  if (min <= 90) return 1;
  return 2;
}

// --- Zoom auth
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

// --- DB
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");

let totalClasses = 0;
let totalParticipants = 0;
let skipped0h = 0;
let skippedDup = 0;

try {
  for (const meeting of MEETINGS) {
    const { rows: [g] } = await db.query(
      `SELECT id, teacher_id, name FROM student_groups WHERE name = $1`,
      [meeting.group_name],
    );
    if (!g) {
      console.log(`\n✗ grupo no encontrado en DB: "${meeting.group_name}" — salto`);
      continue;
    }

    const { rows: members } = await db.query(
      `SELECT s.id AS student_id, s.pack_started_at, u.full_name,
              m.joined_at AS group_joined_at
         FROM student_group_members m
         JOIN students s ON s.id = m.student_id
         JOIN users u    ON u.id = s.user_id
        WHERE m.group_id = $1
        ORDER BY u.full_name`,
      [g.id],
    );

    // SAFETY: si algún miembro no tiene joined_at registrado, abortar este grupo.
    const sinFecha = members.filter(m => !m.group_joined_at);
    if (sinFecha.length > 0) {
      console.log(`  ✗ ABORT: ${sinFecha.length} miembros sin group_joined_at: ${sinFecha.map(s=>s.full_name).join(", ")}`);
      console.log(`    Rellena student_group_members.joined_at antes de re-ejecutar.`);
      continue;
    }

    console.log(`\n── ${g.name}  (${members.length} miembros) ──`);

    let instances;
    try {
      const res = await zget(`/past_meetings/${meeting.zoom_id}/instances`);
      instances = res.meetings ?? [];
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      continue;
    }
    const aprilInstances = instances.filter(i => (i.start_time ?? "").startsWith(TARGET_MONTH));

    for (const inst of aprilInstances) {
      // ¿Ya está en DB? Idempotencia.
      const dup = await db.query(
        `SELECT 1 FROM classes WHERE notes_admin = $1 LIMIT 1`,
        [`zoom_uuid=${inst.uuid}`],
      );
      if (dup.rowCount > 0) { skippedDup++; continue; }

      const det = await zget(`/past_meetings/${encodeUuid(inst.uuid)}`);
      const minutes = det.duration ?? 0;
      const bh = billedHours(minutes);
      if (bh === 0) {
        skipped0h++;
        console.log(`  · ${det.start_time?.slice(0,10)} ${minutes}min < 15 → no se factura`);
        continue;
      }

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

      let participantCount = 0;
      for (const mem of members) {
        // CRITICAL: solo si el alumno YA era miembro del grupo cuando ocurrió la clase.
        // El bug del 2026-04-19 fue precisamente saltarse este filtro.
        if (new Date(mem.group_joined_at) > new Date(startedAt)) continue;
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
      console.log(`  + ${startedAt.slice(0,10)}  ${minutes}min  bh=${bh}h  → ${participantCount} miembros acreditados`);
    }
  }

  // ============================================================================
  // class_hours_log + teacher_earnings rollup
  // ============================================================================
  const { rows: chl } = await db.query(`
    INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
    SELECT
      c.id,
      c.teacher_id,
      c.billed_hours * 60,
      CASE c.type WHEN 'individual' THEN t.rate_individual_cents ELSE t.rate_group_cents END / 100.0,
      c.billed_hours *
        (CASE c.type WHEN 'individual' THEN t.rate_individual_cents ELSE t.rate_group_cents END),
      t.currency,
      c.started_at
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    WHERE c.status = 'completed'
      AND c.billed_hours > 0
      AND c.started_at >= '2026-04-01' AND c.started_at < '2026-05-01'
    ON CONFLICT (class_id) DO UPDATE SET
      amount_cents     = EXCLUDED.amount_cents,
      rate_at_time     = EXCLUDED.rate_at_time,
      duration_minutes = EXCLUDED.duration_minutes,
      currency         = EXCLUDED.currency
    RETURNING class_id
  `);
  console.log(`\n✓ class_hours_log: ${chl.length} filas (insert+update)`);

  const { rows: te } = await db.query(`
    INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
    SELECT
      chl.teacher_id,
      DATE_TRUNC('month', chl.created_at)::date,
      SUM(chl.duration_minutes)::int,
      COUNT(*)::int,
      SUM(chl.amount_cents)::int,
      MAX(chl.currency)
    FROM class_hours_log chl
    WHERE chl.created_at >= '2026-04-01' AND chl.created_at < '2026-05-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      currency      = EXCLUDED.currency,
      updated_at    = now()
    RETURNING teacher_id, amount_cents
  `);
  console.log(`✓ teacher_earnings (abril): ${te.length} filas`);

  await db.query("COMMIT");
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  ✓ COMMIT — ${totalClasses} clases nuevas, ${totalParticipants} acreditaciones`);
  console.log(`            (${skippedDup} duplicadas, ${skipped0h} <15min ignoradas)`);
  console.log(`══════════════════════════════════════════════════`);
} catch (e) {
  await db.query("ROLLBACK");
  console.error("\n✗ ROLLBACK por error:", e.message);
  await db.end();
  process.exit(1);
}

// ============================================================================
// Verificación final
// ============================================================================
console.log("\n══════════ NÓMINA ABRIL 2026 (post-backfill) ══════════");
const { rows: payroll } = await db.query(`
  SELECT u.full_name,
         te.classes_count,
         te.total_minutes / 60 AS hours,
         te.amount_cents / 100.0 AS amount_eur,
         te.currency,
         te.paid
    FROM teacher_earnings te
    JOIN teachers t ON t.id = te.teacher_id
    JOIN users    u ON u.id = t.user_id
   WHERE te.month = '2026-04-01'
   ORDER BY te.amount_cents DESC
`);
let total = 0;
for (const r of payroll) {
  console.log(`  ${(r.full_name ?? "—").padEnd(20)} ${String(r.classes_count).padStart(2)} clases · ${String(r.hours).padStart(3)}h → ${String(r.amount_eur).padStart(6)} ${r.currency}  ${r.paid ? "[PAGADO]" : "[pendiente]"}`);
  total += Number(r.amount_eur);
}
console.log(`  ──────────────────────────────────────────────`);
console.log(`  TOTAL ABRIL:  ${total.toFixed(2)} EUR`);

console.log("\n══════════ PAQUETES DE ALUMNOS (post-backfill) ══════════");
const { rows: packs } = await db.query(`
  SELECT u.full_name,
         s.classes_purchased,
         s.classes_remaining,
         (s.classes_purchased - s.classes_remaining) AS consumed,
         s.pack_started_at, s.pack_expires_at
    FROM students s
    JOIN users u ON u.id = s.user_id
   WHERE s.pack_started_at IS NOT NULL
     AND (s.pack_expires_at IS NULL OR s.pack_expires_at >= '2026-04-01')
   ORDER BY u.full_name
`);
for (const p of packs) {
  console.log(`  ${(p.full_name ?? "—").padEnd(24)} ${String(p.consumed).padStart(3)}/${p.classes_purchased} consumidas · restan ${String(p.classes_remaining).padStart(2)}`);
}

await db.end();
