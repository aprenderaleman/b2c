#!/usr/bin/env node
/** Record Isabella's just-sent first message + advance her status. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const db = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// Inspect timeline_author enum values
const enumRes = await db.query(`
  SELECT e.enumlabel FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'timeline_author'
  ORDER BY e.enumsortorder
`);
console.log("timeline_author enum values:", enumRes.rows.map(r => r.enumlabel));

const leadQ = await db.query(`SELECT id, name, status FROM leads WHERE name ILIKE '%Isabel%' LIMIT 1`);
if (leadQ.rows.length === 0) { console.error("Lead not found"); process.exit(1); }
const lead = leadQ.rows[0];
console.log("Lead:", lead);

const messageText =
`¡Hola Isabella! 👋

Soy Stiv de Aprender-Aleman.de — recibimos tu solicitud.

Nos gustaría invitarte a una *clase de prueba gratuita* para conocer tu nivel y diseñarte un plan personalizado para que entres a la universidad alemana.

¿Te envío el enlace para que elijas el horario que mejor te venga?

Stiv, Aprender-Aleman.de`;

// Use 'gelfis' as author (valid enum) since this was a manual backfill
await db.query(
  `INSERT INTO lead_timeline (lead_id, type, author, content, metadata)
   VALUES ($1, 'system_message_sent', 'gelfis', $2, $3::jsonb)`,
  [lead.id, messageText, JSON.stringify({
    message_id: "3EB04E0CE46481F49ECAD7",
    source:     "manual_backfill_scheduler_down",
    sent_at:    new Date().toISOString(),
  })],
);

// Also log in message_send_log so the agents see this send as real
await db.query(
  `INSERT INTO message_send_log (lead_id, sent_at, instance, to_number, message_body, success, retry_count)
   VALUES ($1, NOW(), 'aprender-aleman-main', '+524271447814', $2, TRUE, 0)`,
  [lead.id, messageText],
);

// Advance status
const nextAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
await db.query(
  `UPDATE leads
      SET status = 'contacted_1'::lead_status,
          current_followup_number = 1,
          next_contact_date = $1
    WHERE id = $2`,
  [nextAt, lead.id],
);

const verify = await db.query(`SELECT status, current_followup_number, next_contact_date FROM leads WHERE id = $1`, [lead.id]);
console.log("✓ updated:", verify.rows[0]);

await db.end();
