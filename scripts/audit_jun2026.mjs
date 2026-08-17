import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}
const APPLY = process.argv.includes("--apply");
const c = new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

// Teacher ids + rates (cents per academic hour)
const TID = {
  florian: '544a84e9-7cc6-4f32-a342-21a5c14a137b',
  sabine:  '72d93d60-a9b2-43f0-9507-36e8d26da4ed',
  simon:   '42aa943a-d305-420f-83bb-da0f68df6b7f',
};
const RATE = {
  florian: { ind: 1500, group: 1700 },
  sabine:  { ind: 1500, group: 1700 },
  simon:   { ind: 1300, group: 1500 },
};

// Decisions: { class_id: { action, bh, actMin, amt, label } }
const decisions = [];

// ── FLORIAN ──────────────────────────────────────────────────────
// Pattern: Fernanda attended=false + rec=0 → no clase (regla previa)
const florianFernandaNoShow = [
  ['9b1a... TODO replace', '06-01 Fernanda rec=0 att=false → 0€'],
];
// Actually let me list by class IDs from query

// I'll do this via SQL filters instead of hard-coding IDs.
const fernandaNoShows = await c.query(`
SELECT c.id::text FROM classes c
 JOIN teachers t ON t.id=c.teacher_id
 JOIN class_participants cp ON cp.class_id=c.id
 WHERE c.teacher_id='${TID.florian}'::uuid
   AND c.status='completed'
   AND c.scheduled_at >= date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin')
   AND c.scheduled_at <  date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin') + INTERVAL '1 month'
   AND c.type='individual'
   AND c.title ILIKE '%Fernanda%'
   AND cp.attended = false
   AND (SELECT COALESCE(MAX(r.duration_seconds),0)/60 FROM recordings r WHERE r.class_id=c.id AND r.status='ready') < 15
`);

for (const r of fernandaNoShows.rows) {
  decisions.push({ class_id: r.id, action: 'remove_log', label: 'Florian Fernanda attended=false rec=0 → 0€' });
}

// Florian 06-05 group A2-B1 rec=17m, 4 absent, currently billed 2u
// Per rule: rec<30 + all absent → 50% group = 850c (was 3400c, reduce)
decisions.push({
  class_id: 'a43fcb2d-5746-4d03-908a-86d4702cb28c-PLACEHOLDER',
  action: '__find',
  search: { teacher: TID.florian, day: '2026-06-05', hour: 18, type: 'group' },
  bh: 0, amt: 850, dur: 25, rate_per_h: 17,
  label: 'Florian 06-05 18:00 group A2-B1 rec=17m all absent → 50%',
});

// Florian 06-10 group: rec=0, recording just processing. Skip for now.
// Florian 06-03, 06-02 etc. already billed full where appropriate.

// ── SABINE ──────────────────────────────────────────────────────
// Bill at 1u where rec≥30m and attended is consistent
const sabineBills = await c.query(`
SELECT c.id::text, to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','MM-DD HH24:MI') AS berlin,
       c.type, c.duration_minutes AS plan,
       (SELECT COALESCE(MAX(r.duration_seconds),0)/60 FROM recordings r WHERE r.class_id=c.id AND r.status='ready')::int AS rec,
       (SELECT COUNT(*) FILTER (WHERE attended=true) FROM class_participants cp WHERE cp.class_id=c.id)::int AS yes,
       (SELECT COUNT(*) FILTER (WHERE attended=false) FROM class_participants cp WHERE cp.class_id=c.id)::int AS no_
  FROM classes c
 WHERE c.teacher_id='${TID.sabine}'::uuid
   AND c.status='completed'
   AND c.scheduled_at >= date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin')
   AND c.scheduled_at <  date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin') + INTERVAL '1 month'
   AND COALESCE(c.billed_hours,0) = 0
   AND NOT EXISTS (SELECT 1 FROM class_hours_log chl WHERE chl.class_id=c.id)
`);

for (const r of sabineBills.rows) {
  if (r.rec < 15) continue;  // skip garbage
  const isGroup = r.type === 'group';
  // Universal billing: minutes → academic units
  let units;
  if (r.rec < 15) units = 0;
  else if (r.rec <= 75) units = 1;
  else if (r.rec <= 125) units = 2;
  else if (r.rec <= 175) units = 3;
  else units = Math.ceil(r.rec / 50);
  const ratePerH = isGroup ? RATE.sabine.group : RATE.sabine.ind;
  const amt = units * ratePerH;
  const dur = units * 50;
  decisions.push({
    class_id: r.id, action: 'bill', bh: units, amt, dur, rate_per_h: ratePerH/100,
    label: `Sabine ${r.berlin} ${r.type} rec=${r.rec}m → ${units}u = ${amt/100}€`,
  });
}

// Duplicate detection: 06-08 13:00 Jeaneth where rec=0 + attended=false + bh=1
const sabineDup = await c.query(`
SELECT c.id::text
  FROM classes c JOIN class_participants cp ON cp.class_id=c.id
 WHERE c.teacher_id='${TID.sabine}'::uuid
   AND c.scheduled_at = '2026-06-08 11:00:00+00'
   AND c.title ILIKE '%Jeaneth%'
   AND cp.attended = false
   AND COALESCE(c.billed_hours,0) > 0
`);
for (const r of sabineDup.rows) {
  decisions.push({ class_id: r.id, action: 'cancel_dup', label: 'Sabine 06-08 13:00 Jeaneth duplicate (attended=false)' });
}

// ── SIMON ──────────────────────────────────────────────────────
const simonBills = await c.query(`
SELECT c.id::text, to_char(c.scheduled_at AT TIME ZONE 'Europe/Berlin','MM-DD HH24:MI') AS berlin,
       c.type, c.duration_minutes AS plan,
       (SELECT COALESCE(MAX(r.duration_seconds),0)/60 FROM recordings r WHERE r.class_id=c.id AND r.status='ready')::int AS rec,
       (SELECT COUNT(*) FILTER (WHERE attended=true) FROM class_participants cp WHERE cp.class_id=c.id)::int AS yes,
       (SELECT COUNT(*) FILTER (WHERE attended=false) FROM class_participants cp WHERE cp.class_id=c.id)::int AS no_,
       LEFT(COALESCE(c.title,''),30) AS title
  FROM classes c
 WHERE c.teacher_id='${TID.simon}'::uuid
   AND c.status='completed'
   AND c.scheduled_at >= date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin')
   AND c.scheduled_at <  date_trunc('month', NOW() AT TIME ZONE 'Europe/Berlin') + INTERVAL '1 month'
   AND COALESCE(c.billed_hours,0) = 0
   AND NOT EXISTS (SELECT 1 FROM class_hours_log chl WHERE chl.class_id=c.id)
`);

for (const r of simonBills.rows) {
  const isGroup = r.type === 'group';
  const ratePerH = isGroup ? RATE.simon.group : RATE.simon.ind;

  // Special case: Lydia 06-04 group, rec=34m + all absent → no-show 50%
  if (r.title.includes('Lydia') && r.no_ > 0 && r.yes === 0) {
    decisions.push({
      class_id: r.id, action: 'bill_half', bh: 0, amt: Math.round(ratePerH/2), dur: 25, rate_per_h: ratePerH/100,
      label: `Simon ${r.berlin} ${r.title} no-show → 50% = ${Math.round(ratePerH/2)/100}€`,
    });
    continue;
  }

  // If rec < 15 and no attended=true, skip (no evidence)
  if (r.rec < 15 && r.yes === 0) continue;

  // Normal billing: use rec if available, else fall back to plan
  const minutesForUnits = r.rec >= 15 ? r.rec : r.plan;
  let units;
  if (minutesForUnits < 15) units = 0;
  else if (minutesForUnits <= 75) units = 1;
  else if (minutesForUnits <= 125) units = 2;
  else if (minutesForUnits <= 175) units = 3;
  else units = Math.ceil(minutesForUnits / 50);
  const amt = units * ratePerH;
  const dur = units * 50;
  decisions.push({
    class_id: r.id, action: 'bill', bh: units, amt, dur, rate_per_h: ratePerH/100,
    label: `Simon ${r.berlin} ${r.title} ${r.type} rec=${r.rec}m → ${units}u = ${amt/100}€`,
  });
}

// Print decisions grouped by action
const byAction = {};
for (const d of decisions) (byAction[d.action] = byAction[d.action] || []).push(d);
for (const [a, arr] of Object.entries(byAction)) {
  console.log(`\n--- ${a} (${arr.length}) ---`);
  for (const d of arr) console.log(`  ${d.label}`);
}

if (!APPLY) {
  console.log("\n[DRY RUN — re-corre con --apply]");
  await c.end(); process.exit(0);
}

// Resolve __find placeholders
for (const d of decisions) {
  if (d.action === '__find') {
    const r = await c.query(`
      SELECT id::text FROM classes WHERE teacher_id=$1::uuid
       AND scheduled_at = $2::timestamptz AND type=$3
       LIMIT 1`, [d.search.teacher, '2026-06-05 16:00:00+00', d.search.type]);
    if (r.rows[0]) d.class_id = r.rows[0].id;
    else { console.log('Could not find:', d.label); continue; }
  }
}

// Apply
for (const d of decisions) {
  try {
    if (d.action === 'remove_log') {
      await c.query(`DELETE FROM class_hours_log WHERE class_id=$1::uuid`, [d.class_id]);
      await c.query(`UPDATE classes SET billed_hours=0 WHERE id=$1::uuid`, [d.class_id]);
      console.log(`✓ ${d.label}`);
    } else if (d.action === 'cancel_dup') {
      await c.query(`DELETE FROM class_hours_log WHERE class_id=$1::uuid`, [d.class_id]);
      await c.query(`UPDATE classes SET status='cancelled', billed_hours=0 WHERE id=$1::uuid`, [d.class_id]);
      console.log(`✓ ${d.label}`);
    } else if (d.action === 'bill') {
      await c.query(`UPDATE classes SET billed_hours=$1, actual_duration_minutes=$2 WHERE id=$3::uuid`,
        [d.bh, d.dur, d.class_id]);
      // Trigger should auto-insert log; verify
      const ex = await c.query(`SELECT 1 FROM class_hours_log WHERE class_id=$1`, [d.class_id]);
      if (ex.rows.length === 0) {
        const tid = (await c.query(`SELECT teacher_id::text FROM classes WHERE id=$1`, [d.class_id])).rows[0].teacher_id;
        await c.query(`INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency)
                       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'EUR')`,
          [d.class_id, tid, d.dur, d.rate_per_h, d.amt]);
      }
      console.log(`✓ ${d.label}`);
    } else if (d.action === 'bill_half' || d.action === '__find') {
      // half-rate manual log, bh stays 0
      const tid = (await c.query(`SELECT teacher_id::text FROM classes WHERE id=$1`, [d.class_id])).rows[0].teacher_id;
      // Update class actual_duration to indicate no-show
      await c.query(`UPDATE classes SET billed_hours=0, actual_duration_minutes=$1 WHERE id=$2::uuid`,
        [d.dur, d.class_id]);
      // Remove any existing log for class then insert half
      await c.query(`DELETE FROM class_hours_log WHERE class_id=$1::uuid`, [d.class_id]);
      await c.query(`INSERT INTO class_hours_log (class_id, teacher_id, duration_minutes, rate_at_time, amount_cents, currency)
                     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'EUR')`,
        [d.class_id, tid, d.dur, d.rate_per_h, d.amt]);
      console.log(`✓ ${d.label}`);
    }
  } catch (e) {
    console.error(`✗ ${d.label}: ${e.message}`);
  }
}

// Recompute all 4 teachers for June
const all = await c.query(`SELECT t.id::text FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.full_name IN ('Sabine Arning','Veronica Fusco','Florian Zormann','Simon Heimler Castro')`);
for (const r of all.rows) {
  await c.query(`SELECT recompute_teacher_month($1::uuid, '2026-06-01'::date)`, [r.id]);
}

// Final rollup
const p = await c.query(`
SELECT u.full_name, te.classes_count AS cls, te.total_minutes AS min,
       (te.amount_cents/100.0)::float AS eur, te.paid
  FROM teacher_earnings te JOIN teachers t ON t.id=te.teacher_id JOIN users u ON u.id=t.user_id
 WHERE te.month='2026-06-01' AND u.full_name IN ('Sabine Arning','Veronica Fusco','Florian Zormann','Simon Heimler Castro')
 ORDER BY te.amount_cents DESC`);
console.log('\n=== NÓMINA JUNIO (parcial — mes en curso) ===');
console.table(p.rows);
console.log('TOTAL JUN:', p.rows.reduce((a,b)=>a+b.eur,0).toFixed(2), '€');

await c.end();
