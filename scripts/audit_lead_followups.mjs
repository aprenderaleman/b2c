#!/usr/bin/env node
/**
 * Auditoría exhaustiva de seguimiento de leads. Identifica:
 *   - Cuántos leads existen y en qué estados
 *   - Cuántos están "abandonados" (sin actividad reciente, status no terminal)
 *   - Por qué Agent 0 no los procesa (falta de next_contact_date,
 *     status pausado, etc.)
 *   - Cuándo fue el último mensaje a/desde cada uno
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

console.log("══════════ 1. DISTRIBUCIÓN POR STATUS ══════════");
const r1 = await c.query(`
  SELECT status, COUNT(*)::int AS n,
         MIN(created_at) AS oldest,
         MAX(created_at) AS newest
    FROM leads
   GROUP BY status
   ORDER BY n DESC`);
for (const r of r1.rows) {
  console.log(`  ${r.status.padEnd(22)}  n=${String(r.n).padStart(4)}  oldest=${r.oldest?.toISOString?.()?.slice(0,10)}  newest=${r.newest?.toISOString?.()?.slice(0,10)}`);
}

console.log("\n══════════ 2. LEADS QUE AGENT_0 RECOGE EN ESTE MOMENTO ══════════");
// Réplica exacta del query de _leads_due en agent_0_watcher.py
const PAUSED = ['needs_human','converted','cold','lost','trial_scheduled','trial_reminded'];
const r2 = await c.query(`
  SELECT id, name, status, current_followup_number AS fu,
         next_contact_date, created_at, updated_at,
         (SELECT MAX(timestamp) FROM lead_timeline lt WHERE lt.lead_id = leads.id AND lt.type='lead_message_received') AS last_inbound,
         (SELECT MAX(timestamp) FROM lead_timeline lt WHERE lt.lead_id = leads.id AND lt.type='system_message_sent') AS last_outbound
    FROM leads
   WHERE (status = 'new' AND next_contact_date IS NULL)
      OR (next_contact_date IS NOT NULL AND next_contact_date <= NOW() AND status NOT IN (${PAUSED.map((_,i)=>'$'+(i+1)).join(',')}))
   ORDER BY COALESCE(next_contact_date, created_at)`, PAUSED);
console.log(`  Total: ${r2.rows.length}`);
for (const r of r2.rows) {
  console.log(`  ${r.id.slice(0,8)}  ${(r.name??'—').padEnd(22)}  ${r.status.padEnd(18)}  fu=${r.fu}  next=${r.next_contact_date?.toISOString?.()?.slice(0,16)??'—'}  in=${r.last_inbound?.toISOString?.()?.slice(0,10)??'—'}  out=${r.last_outbound?.toISOString?.()?.slice(0,10)??'—'}`);
}

console.log("\n══════════ 3. LEADS \"OLVIDADOS\" (no en estado terminal, sin processed por agent_0) ══════════");
// Leads en status NO terminal Y NO en lista de pausados Y SIN next_contact_date Y NO 'new'
// (porque 'new' ya está cubierto por el query del agent_0).
const r3 = await c.query(`
  SELECT id, name, status, current_followup_number AS fu,
         next_contact_date, created_at, updated_at,
         (SELECT MAX(timestamp) FROM lead_timeline lt WHERE lt.lead_id = leads.id AND lt.type='lead_message_received') AS last_inbound,
         (SELECT MAX(timestamp) FROM lead_timeline lt WHERE lt.lead_id = leads.id AND lt.type='system_message_sent') AS last_outbound,
         EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 AS days_idle
    FROM leads
   WHERE status NOT IN ('new','needs_human','converted','cold','lost','trial_scheduled','trial_reminded')
     AND next_contact_date IS NULL
   ORDER BY updated_at`);
console.log(`  Total: ${r3.rows.length}`);
for (const r of r3.rows) {
  console.log(`  ${r.id.slice(0,8)}  ${(r.name??'—').padEnd(22)}  ${r.status.padEnd(18)}  fu=${r.fu}  ${Number(r.days_idle).toFixed(1)}d sin update  in=${r.last_inbound?.toISOString?.()?.slice(0,10)??'—'}  out=${r.last_outbound?.toISOString?.()?.slice(0,10)??'—'}`);
}

console.log("\n══════════ 4. LEADS CON STATUS TERMINAL PERO RECIENTE ACTIVIDAD INBOUND ══════════");
// Si un lead 'cold' o 'lost' nos vuelve a escribir, ¿se reactiva?
const r4 = await c.query(`
  SELECT l.id, l.name, l.status, l.updated_at,
         (SELECT MAX(timestamp) FROM lead_timeline lt2 WHERE lt2.lead_id = l.id AND lt2.type='lead_message_received') AS last_inbound
    FROM leads l
   WHERE l.status IN ('cold','lost','needs_human')
     AND EXISTS (
       SELECT 1 FROM lead_timeline lt
        WHERE lt.lead_id = l.id
          AND lt.type='lead_message_received'
          AND lt.timestamp > l.updated_at  -- inbound DESPUÉS del último cambio
     )
   ORDER BY (SELECT MAX(timestamp) FROM lead_timeline lt2 WHERE lt2.lead_id = l.id AND lt2.type='lead_message_received') DESC NULLS LAST
   LIMIT 30`);
console.log(`  Total: ${r4.rows.length}`);
for (const r of r4.rows) {
  console.log(`  ${r.id.slice(0,8)}  ${(r.name??'—').padEnd(22)}  ${r.status.padEnd(15)}  inbound_last=${r.last_inbound?.toISOString?.()?.slice(0,10)}  status_set=${r.updated_at?.toISOString?.()?.slice(0,10)}`);
}

console.log("\n══════════ 5. LEADS \"NEW\" SIN next_contact_date PERO CON antigüedad >24h ══════════");
const r5 = await c.query(`
  SELECT id, name, status, created_at, updated_at,
         EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours_old
    FROM leads
   WHERE status='new' AND next_contact_date IS NULL
     AND created_at < NOW() - INTERVAL '24 hours'
   ORDER BY created_at`);
console.log(`  Total: ${r5.rows.length}`);
for (const r of r5.rows.slice(0,15)) {
  console.log(`  ${r.id.slice(0,8)}  ${(r.name??'—').padEnd(22)}  ${Number(r.hours_old).toFixed(0)}h sin tocar  created=${r.created_at?.toISOString?.()?.slice(0,10)}`);
}
if (r5.rows.length > 15) console.log(`  ... y ${r5.rows.length-15} más`);

console.log("\n══════════ 6. RESUMEN ══════════");
const r6 = await c.query(`
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('converted','lost','cold','needs_human')) AS active,
    COUNT(*) FILTER (WHERE status NOT IN ('converted','lost','cold','needs_human')
                      AND next_contact_date IS NULL AND status != 'new') AS abandoned,
    COUNT(*) FILTER (WHERE status='new' AND next_contact_date IS NULL) AS new_pristine,
    COUNT(*) FILTER (WHERE status='new' AND next_contact_date IS NULL
                      AND created_at < NOW() - INTERVAL '7 days') AS new_pristine_old
   FROM leads`);
const s = r6.rows[0];
console.log(`  Leads activos (no terminales):                  ${s.active}`);
console.log(`  ├─ "Olvidados" (sin next_contact_date, no 'new'): ${s.abandoned}  ← ⚠ AQUÍ ESTÁ EL BUG`);
console.log(`  ├─ "new" sin próximo contacto:                   ${s.new_pristine}`);
console.log(`  └─ "new" pristine de >7 días:                    ${s.new_pristine_old}  ← agent_0 los va a procesar`);

await c.end();
