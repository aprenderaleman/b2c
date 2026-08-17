#!/usr/bin/env node
/**
 * Resolver los unmatched_inbounds que pertenecen a leads conocidos:
 *   1. Asmaa Aouissi Doumi  → "Cambio de hora" (urgente, trial mañana)
 *   2. Juan Manuel García   → "Si" (ya superado por flujo posterior)
 *   3. Valentín Icabazeta   → "Buen día" / "Pues es que..." (status lost — no responder)
 *
 * Para cada uno:
 *   - Vincular el `whatsapp_lid` al lead (futuros mensajes resuelven O(1))
 *   - Marcar la fila de `unmatched_inbounds` como resolved
 *   - Insertar `lead_message_received` en lead_timeline (para que aparezca
 *     en el panel admin)
 *   - SOLO para Asmaa: encolar en inbound_processing_queue para que el
 *     agente_4 genere y envíe respuesta
 */
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
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();

const TARGETS = [
  {
    leadName: "Asmaa Aouissi Doumi",
    leadId:   "4f740faa-008b-4037-9da5-0e081afffe71",
    lid:      "12326656856202@lid",
    enqueueAgent: true,
  },
  {
    leadName: "Juan Manuel García ufarte",
    leadId:   null,                                  // resolver por nombre
    lid:      "76360877903903@lid",
    enqueueAgent: false,
  },
  {
    leadName: "Valentín Icabazeta",
    leadId:   null,
    lid:      null,                                  // múltiples filas, pillamos el lid de las rows
    enqueueAgent: false,
  },
];

await c.query("BEGIN");
try {
  for (const t of TARGETS) {
    let leadId = t.leadId;
    if (!leadId) {
      const r = await c.query(`SELECT id FROM leads WHERE name = $1 LIMIT 1`, [t.leadName]);
      leadId = r.rows[0]?.id;
      if (!leadId) { console.log(`  ✗ no encontré lead "${t.leadName}", skip`); continue; }
    }
    // Tomar todas las unmatched filas de este push_name + lid candidato
    const filterByLid = t.lid ? "AND jid = $2" : "";
    const params = t.lid ? [leadName(t.leadName), t.lid] : [leadName(t.leadName)];
    const filterPushName = t.leadName === "Juan Manuel García ufarte" ? "juanma"
                         : t.leadName === "Valentín Icabazeta" ? "Valen"
                         : "A";
    const { rows: ums } = await c.query(`
      SELECT id, jid, push_name, content_preview, received_at
        FROM unmatched_inbounds
       WHERE resolved_at IS NULL
         AND push_name = $1
       ORDER BY received_at`, [filterPushName]);
    if (ums.length === 0) { console.log(`  · ${t.leadName}: 0 filas pendientes`); continue; }

    // Para Asmaa filtramos al jid concreto que vimos
    const filtered = t.lid ? ums.filter(u => u.jid === t.lid) : ums;
    console.log(`\n→ ${t.leadName} (${leadId}) — ${filtered.length} mensaje(s)`);

    // Vincular LID en leads (toma el primero — todos deberían ser el mismo)
    const lid = t.lid ?? filtered[0]?.jid;
    if (lid) {
      await c.query(
        `UPDATE leads SET whatsapp_lid = $1 WHERE id = $2 AND (whatsapp_lid IS NULL OR whatsapp_lid <> $1)`,
        [lid, leadId]);
      console.log(`   ✓ whatsapp_lid = ${lid}`);
    }

    for (const u of filtered) {
      // Insertar en lead_timeline
      await c.query(`
        INSERT INTO lead_timeline (lead_id, type, author, content, timestamp, metadata)
        VALUES ($1, 'lead_message_received', 'lead', $2, $3, $4)`,
        [leadId, u.content_preview ?? "", u.received_at, { lid: u.jid, push_name: u.push_name, recovered_from_unmatched: true }]);
      // Marcar resolved
      await c.query(`
        UPDATE unmatched_inbounds SET resolved_at = NOW(), resolved_lead_id = $1 WHERE id = $2`,
        [leadId, u.id]);
      console.log(`   ✓ [${u.received_at.toISOString().slice(5,16)}] "${(u.content_preview??"").slice(0,60)}"`);

      // Encolar para el agente solo si pidieron respuesta
      if (t.enqueueAgent && u.content_preview && u.content_preview.trim().length > 0) {
        await c.query(`
          INSERT INTO inbound_processing_queue (lead_id, text, status, queued_at)
          VALUES ($1, $2, 'pending', NOW())`,
          [leadId, u.content_preview]);
        console.log(`     → encolado para agente_4`);
      }
    }
  }
  await c.query("COMMIT");
  console.log("\n✓ COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("\n✗ ROLLBACK:", e.message);
  process.exit(1);
}

function leadName(n) { return n; }   // placeholder — no se usa realmente

await c.end();
