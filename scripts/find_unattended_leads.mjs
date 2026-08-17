#!/usr/bin/env node
/**
 * Detecta leads que pueden necesitar atención AHORA:
 *   1. Trials hoy/mañana sin recordatorios completos
 *   2. Leads con inbound reciente (>15min) sin respuesta del bot/admin
 *   3. Leads en estados intermedios sin actividad >24h
 *   4. Leads con send_failed reciente
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

console.log("══════════ 1. TRIALS HOY/MAÑANA — estado de recordatorios ══════════");
const r1 = await c.query(`
  SELECT cls.id, cls.scheduled_at, cls.notes_admin, cls.status,
         l.name, l.email, l.whatsapp_normalized, l.language
    FROM classes cls
    JOIN leads l ON l.id = cls.lead_id
   WHERE cls.is_trial = TRUE
     AND cls.status = 'scheduled'
     AND cls.scheduled_at >= NOW() - INTERVAL '1 hour'
     AND cls.scheduled_at <= NOW() + INTERVAL '36 hours'
   ORDER BY cls.scheduled_at`);
for (const r of r1.rows) {
  const has24h     = (r.notes_admin ?? "").includes("[trial_reminder_24h_email_sent]");
  const hasMorning = (r.notes_admin ?? "").includes("[trial_reminder_morning_email_sent]");
  const has30m     = (r.notes_admin ?? "").includes("[pre_class_30m_sent]");
  console.log(`  ${r.scheduled_at.toISOString().slice(0,16)}  ${r.name.padEnd(28)}  24h=${has24h?"✓":"✗"}  morning=${hasMorning?"✓":"✗"}  30m=${has30m?"✓":"✗"}`);
}
if (r1.rows.length === 0) console.log("  (sin trials en próximas 36h)");

console.log("\n══════════ 2. INBOUNDS RECIENTES SIN RESPUESTA (silent) ══════════");
const r2 = await c.query(`
  WITH last_inbound AS (
    SELECT lt.lead_id, MAX(lt.timestamp) AS last_at
      FROM lead_timeline lt
     WHERE lt.type = 'lead_message_received'
       AND lt.timestamp > NOW() - INTERVAL '24 hours'
     GROUP BY lt.lead_id
  )
  SELECT li.lead_id, li.last_at, l.name, l.status, l.whatsapp_normalized,
         (SELECT lt2.content FROM lead_timeline lt2
           WHERE lt2.lead_id = li.lead_id AND lt2.type='lead_message_received'
           ORDER BY lt2.timestamp DESC LIMIT 1) AS last_msg
    FROM last_inbound li
    JOIN leads l ON l.id = li.lead_id
   WHERE li.last_at < NOW() - INTERVAL '15 minutes'
     AND l.status NOT IN ('lost','converted','cold')
     AND (l.ai_paused_until IS NULL OR l.ai_paused_until <= NOW())
     AND NOT EXISTS (
       SELECT 1 FROM lead_timeline lt3
        WHERE lt3.lead_id = li.lead_id
          AND lt3.timestamp > li.last_at
          AND lt3.type IN ('system_message_sent','status_change','escalation')
     )
   ORDER BY li.last_at DESC`);
for (const r of r2.rows) {
  const ago = Math.round((Date.now() - r.last_at.getTime()) / 60000);
  console.log(`  ⚠ ${r.name.padEnd(28)}  status=${r.status}  hace ${ago}min  "${(r.last_msg??"").slice(0,80)}"`);
}
if (r2.rows.length === 0) console.log("  ✓ (cero inbounds silenciosos)");

console.log("\n══════════ 3. LEADS EN ESTADOS INTERMEDIOS >24h SIN MOVIMIENTO ══════════");
const r3 = await c.query(`
  SELECT l.id, l.name, l.status, l.next_contact_date, l.updated_at,
         l.whatsapp_normalized, l.reactivation_count
    FROM leads l
   WHERE l.status IN ('link_sent','in_conversation','contacted_2','contacted_3','contacted_4','absent_followup_1','absent_followup_2')
     AND l.updated_at < NOW() - INTERVAL '24 hours'
     AND (l.ai_paused_until IS NULL OR l.ai_paused_until <= NOW())
   ORDER BY l.updated_at`);
for (const r of r3.rows) {
  const ago = Math.round((Date.now() - r.updated_at.getTime()) / 3600_000);
  console.log(`  ${r.name.padEnd(28)}  ${r.status.padEnd(20)}  ${ago}h sin update  rc=${r.reactivation_count}  next=${r.next_contact_date?.toISOString?.()?.slice(0,16)??"NULL ⚠"}`);
}
if (r3.rows.length === 0) console.log("  ✓ (sin leads atascados)");

console.log("\n══════════ 4. SEND_FAILED ÚLTIMAS 24H ══════════");
const r4 = await c.query(`
  SELECT lt.timestamp, lt.lead_id, l.name, lt.content
    FROM lead_timeline lt
    JOIN leads l ON l.id = lt.lead_id
   WHERE lt.type = 'send_failed'
     AND lt.timestamp > NOW() - INTERVAL '24 hours'
   ORDER BY lt.timestamp DESC LIMIT 20`);
for (const r of r4.rows) {
  console.log(`  ${r.timestamp.toISOString().slice(11,19)}  ${r.name.padEnd(28)}  "${(r.content??"").slice(0,90)}"`);
}
if (r4.rows.length === 0) console.log("  ✓ (sin fallos)");

await c.end();
