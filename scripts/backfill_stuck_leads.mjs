#!/usr/bin/env node
/**
 * Backfill manual: setea next_contact_date para los 4 leads que estaban
 * atascados antes del fix. Los pone en "manana 08:30 Berlin" (= 06:30 UTC)
 * para respetar la send-window y no spammear de noche.
 *
 * Tras esto:
 *   - Mariam Chavarria  (link_sent, rc=0) -> recibe 1er reminder
 *   - Laura             (link_sent, rc=0) -> recibe 1er reminder
 *   - ona               (in_conversation, rc=0) -> recibe revive (unico)
 *   - Sara              (in_conversation, rc=0) -> recibe revive (unico)
 *
 * Bayron (trial_absent) NO se toca: ya esta cubierto por tick_absent_followups.
 */
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
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query("BEGIN");

try {
  // Mañana 08:30 Berlin = 06:30 UTC. Si ya es despues de eso hoy, +1 dia.
  // Construimos la fecha en SQL para evitar bugs de timezone JS.
  const { rows: [{ next_dt }] } = await c.query(`
    SELECT (
      CASE
        WHEN (NOW() AT TIME ZONE 'Europe/Berlin')::time < '08:30'
          THEN ((NOW() AT TIME ZONE 'Europe/Berlin')::date + TIME '08:30')
                 AT TIME ZONE 'Europe/Berlin'
        ELSE  (((NOW() AT TIME ZONE 'Europe/Berlin')::date + 1) + TIME '08:30')
                 AT TIME ZONE 'Europe/Berlin'
      END
    ) AT TIME ZONE 'UTC' AS next_dt
  `);
  console.log(`Programando next_contact_date = ${next_dt.toISOString()} (= 08:30 Berlin)`);

  const TARGETS = [
    { name: "Mariam Chavarría", expected_status: "link_sent" },
    { name: "Laura",            expected_status: "link_sent" },
    { name: "ona",              expected_status: "in_conversation" },
    { name: "Sara",             expected_status: "in_conversation" },
  ];

  for (const t of TARGETS) {
    const { rows } = await c.query(
      `SELECT id, status, current_followup_number AS fu, reactivation_count AS rc, next_contact_date
         FROM leads
        WHERE name = $1 AND status = $2`,
      [t.name, t.expected_status],
    );
    if (rows.length === 0) {
      console.log(`  ⚠ No encontrado lead "${t.name}" con status=${t.expected_status} — skip`);
      continue;
    }
    const lead = rows[0];
    console.log(`  ✓ ${t.name.padEnd(22)} (${lead.id.slice(0,8)})  status=${lead.status}  fu=${lead.fu}  rc=${lead.rc}  prev_next=${lead.next_contact_date?.toISOString?.() ?? "NULL"}`);
    await c.query(
      `UPDATE leads SET next_contact_date = $1 WHERE id = $2`,
      [next_dt, lead.id],
    );
  }

  await c.query("COMMIT");
  console.log("\n✓ COMMIT — 4 leads agendados para 08:30 Berlin");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}

// Verificación
const { rows: stuck } = await c.query(`
  SELECT name, status, current_followup_number AS fu, reactivation_count AS rc,
         next_contact_date AT TIME ZONE 'Europe/Berlin' AS next_berlin
    FROM leads
   WHERE name IN ('Mariam Chavarría','Laura','ona','Sara')
   ORDER BY name`);
console.log("\nEstado final:");
for (const r of stuck) {
  console.log(`  ${r.name.padEnd(22)}  ${r.status.padEnd(18)}  fu=${r.fu}  rc=${r.rc}  next=${r.next_berlin?.toISOString?.()?.slice(0,16) ?? "—"} Berlin`);
}

await c.end();
