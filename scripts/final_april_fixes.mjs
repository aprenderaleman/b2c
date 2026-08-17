#!/usr/bin/env node
/**
 * APLICACIÓN FINAL — abril 2026.
 *
 * Decisiones de Gelfis:
 *  1. Regla universal: 1 hora facturable = 1 sesión consumida del paquete.
 *     Para mantener el trigger DB existente (que cuenta filas), ajustamos
 *     classes_adjustment de cada estudiante restando (sum_hours - count_parts).
 *  2. Ayman 03-abr 15min (host: Gelfis): Ayman pierde 1 clase, Veronica NO
 *     cobra (no se crea class_hours_log).
 *  3. Ayman 2 reuniones desde otra cuenta (62min + 58min, host: Veronica):
 *     son válidas. Ayman pierde 2 clases. Veronica cobra 17€ × 2 = 34€.
 *  4. Sabine clases de prueba: NO se pagan (Suyapa/Lucía/Ismahane/Kennenlernen).
 *  5. Soulyoga: ignorar (personal de Sabine).
 *
 * Una transacción. Idempotente vía notes_admin = "zoom_uuid=…".
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

// Las 3 clases nuevas que añadimos para Ayman.
const NEW_AYMAN_MEETINGS = [
  { zoom_id: "85038257762", date: "2026-04-03", expected_min: 15, note: "Ayman 03-abr 15min — sin pago a Veronica", pay_teacher: false },
  { zoom_id: "89084594406", date: "2026-04-07", expected_min: 62, note: "Ayman 07-abr 62min (host Nica)",            pay_teacher: true  },
  { zoom_id: "87974064991", date: "2026-04-13", expected_min: 58, note: "Ayman 13-abr 58min (host Nica)",            pay_teacher: true  },
];

const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const { access_token: token } = await (await fetch(
  `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
  { method: "POST", headers: { Authorization: `Basic ${basic}` } },
)).json();
async function zget(p) {
  const r = await fetch(`https://api.zoom.us/v2${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}: ${await r.text()}`);
  return r.json();
}
function encodeUuid(uuid) {
  if (uuid.startsWith("/") || uuid.includes("//")) return encodeURIComponent(encodeURIComponent(uuid));
  return encodeURIComponent(uuid);
}
function billedHours(min) { if (min < 15) return 0; if (min <= 90) return 1; return 2; }

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("BEGIN");

try {
  // ─── PASO 1: insertar las 3 clases nuevas de Ayman ─────────────────────
  // Necesito teacher_id de Veronica + group_id del grupo de Ayman + student_id de Ayman.
  const { rows: [veronica] } = await db.query(`
    SELECT t.id AS teacher_id, t.rate_individual_cents, t.currency
      FROM teachers t JOIN users u ON u.id = t.user_id
     WHERE u.email = 'nicaemila2211@gmail.com'`);
  if (!veronica) throw new Error("Veronica no encontrada");

  const { rows: [aymanGroup] } = await db.query(`
    SELECT id, name FROM student_groups
     WHERE name = 'Ayman Kayali I Aprender-Aleman.de'`);
  if (!aymanGroup) throw new Error("Grupo de Ayman no encontrado");

  const { rows: [aymanStudent] } = await db.query(`
    SELECT s.id FROM students s JOIN users u ON u.id = s.user_id
     WHERE u.email = 'ayman.kayali.lucena@gmail.com'`);
  if (!aymanStudent) throw new Error("Ayman estudiante no encontrado");

  for (const m of NEW_AYMAN_MEETINGS) {
    // Buscar instancias del meeting que sean de la fecha indicada.
    let instances;
    try {
      const r = await zget(`/past_meetings/${m.zoom_id}/instances`);
      instances = r.meetings ?? [];
    } catch (e) {
      console.log(`  ✗ ${m.note}: no se pudo listar instancias: ${e.message}`);
      continue;
    }
    const dateInstances = instances.filter(i => (i.start_time ?? "").startsWith(m.date));
    if (dateInstances.length === 0) {
      console.log(`  ✗ ${m.note}: no encontré instancia de ${m.date}`);
      continue;
    }
    // Filtrar por duración esperada (±2min) entre todas las del día.
    let inst = null, det = null, minutes = 0;
    for (const cand of dateInstances) {
      const cdet = await zget(`/past_meetings/${encodeUuid(cand.uuid)}`);
      const cmin = cdet.duration ?? 0;
      if (Math.abs(cmin - m.expected_min) <= 2) { inst = cand; det = cdet; minutes = cmin; break; }
    }
    if (!inst) {
      const summary = dateInstances.map((c, i) => `${c.start_time?.slice(11,16)}/${c.uuid.slice(0,8)}`).join(", ");
      console.log(`  ✗ ${m.note}: ninguna instancia coincide con ${m.expected_min}min. Disponibles: ${summary}`);
      continue;
    }
    const bh = billedHours(minutes);

    // Idempotencia: si ya existe la clase con este zoom_uuid, salto.
    const exist = await db.query(
      `SELECT id FROM classes WHERE notes_admin = $1 LIMIT 1`,
      [`zoom_uuid=${inst.uuid}`],
    );
    if (exist.rowCount > 0) {
      console.log(`  · ya existe en DB: ${m.note} (uuid=${inst.uuid})`);
      continue;
    }

    const { rows: [cls] } = await db.query(`
      INSERT INTO classes
          (type, teacher_id, group_id, scheduled_at, duration_minutes,
           title, status, started_at, ended_at, actual_duration_minutes,
           billed_hours, notes_admin)
      VALUES ('individual', $1, $2, $3, $4, $5, 'completed', $3, $6, $4, $7, $8)
      RETURNING id`,
      [veronica.teacher_id, aymanGroup.id, det.start_time, minutes,
       `Ayman Kayali — ${m.note}`, det.end_time, bh, `zoom_uuid=${inst.uuid}`]);

    await db.query(`
      INSERT INTO class_participants (class_id, student_id, attended, counts_as_session, minutes_attended)
      VALUES ($1, $2, TRUE, TRUE, $3)
      ON CONFLICT DO NOTHING`,
      [cls.id, aymanStudent.id, minutes]);

    if (m.pay_teacher) {
      const amount = bh * veronica.rate_individual_cents;
      await db.query(`
        INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (class_id) DO UPDATE SET
          duration_minutes = EXCLUDED.duration_minutes,
          rate_at_time     = EXCLUDED.rate_at_time,
          amount_cents     = EXCLUDED.amount_cents,
          currency         = EXCLUDED.currency`,
        [cls.id, veronica.teacher_id, bh * 60, veronica.rate_individual_cents / 100, amount, veronica.currency, det.start_time]);
      console.log(`  ✓ ${m.note}: clase=${cls.id}  bh=${bh}h  → ${amount/100}€ a Veronica`);
    } else {
      console.log(`  ✓ ${m.note}: clase=${cls.id}  bh=${bh}h  → 0€ a Veronica (no_pay)`);
    }
  }

  // ─── PASO 2: re-rollup teacher_earnings(Veronica, abril) ───────────────
  await db.query(`
    INSERT INTO teacher_earnings (teacher_id, month, total_minutes, classes_count, amount_cents, currency)
    SELECT
      chl.teacher_id,
      DATE_TRUNC('month', chl.created_at)::date,
      SUM(chl.duration_minutes)::int,
      COUNT(*)::int,
      SUM(chl.amount_cents)::int,
      MAX(chl.currency)
    FROM class_hours_log chl
    WHERE chl.teacher_id = $1
      AND chl.created_at >= '2026-04-01' AND chl.created_at < '2026-05-01'
    GROUP BY chl.teacher_id, DATE_TRUNC('month', chl.created_at)
    ON CONFLICT (teacher_id, month) DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      classes_count = EXCLUDED.classes_count,
      amount_cents  = EXCLUDED.amount_cents,
      currency      = EXCLUDED.currency,
      updated_at    = now()`,
    [veronica.teacher_id]);

  // ─── PASO 3: regla universal "1h = 1 clase" — ajustar classes_adjustment
  // Para cada estudiante: new_adj = old_adj - (sum_hours - count_parts)
  // ──────────────────────────────────────────────────────────────────────
  const { rows: studentsToFix } = await db.query(`
    SELECT s.id, u.full_name, s.classes_adjustment,
           (SELECT COUNT(*)::int FROM class_participants cp JOIN classes c ON c.id = cp.class_id
             WHERE cp.student_id = s.id AND cp.counts_as_session = TRUE
               AND c.status = 'completed' AND c.billed_hours > 0) AS count_parts,
           (SELECT COALESCE(SUM(c.billed_hours), 0)::int FROM class_participants cp JOIN classes c ON c.id = cp.class_id
             WHERE cp.student_id = s.id AND cp.counts_as_session = TRUE
               AND c.status = 'completed' AND c.billed_hours > 0) AS sum_hours
      FROM students s JOIN users u ON u.id = s.user_id
     WHERE s.classes_purchased > 0`);

  console.log(`\n── Aplicando regla universal 1h=1clase ──`);
  for (const s of studentsToFix) {
    const diff = s.sum_hours - s.count_parts;
    if (diff === 0) {
      console.log(`  ${s.full_name.padEnd(24)}: sum=count=${s.sum_hours}, no cambia`);
      continue;
    }
    const newAdj = s.classes_adjustment - diff;
    await db.query(`UPDATE students SET classes_adjustment = $1 WHERE id = $2`, [newAdj, s.id]);
    await db.query(`SELECT recompute_classes_remaining($1)`, [s.id]);
    console.log(`  ${s.full_name.padEnd(24)}: adj ${s.classes_adjustment}→${newAdj}  (count=${s.count_parts}, sum=${s.sum_hours}, Δ=${-diff})`);
  }

  await db.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await db.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  console.error(e.stack);
  await db.end();
  process.exit(1);
}

await db.end();
