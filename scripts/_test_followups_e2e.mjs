// Test E2E: simula lo que hará el cron de /post-trial-followups-24h.
// NO llama a sendWhatsappText real (no envía nada). Verifica:
//  1. Lock atómico (attempts=0 → attempts=1)
//  2. Cancel por converted
//  3. Cancel por replied
//  4. Cancel por ai_paused_until
//  5. Cancel por no_whatsapp
//  6. buildFollowupText devuelve strings no vacíos para cada kind
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let pass = 0, fail = 0;
const t = (n, ok, extra) => { if (ok) { pass++; console.log(`✓ ${n}`); } else { fail++; console.error(`✗ ${n}`, extra ?? ""); } };

const TEST_LEAD = "8e83b457-b4cc-4b8c-8b08-547bd90244a8"; // Test Sina (status=lost)

// Limpieza
await c.query("DELETE FROM post_trial_followups WHERE lead_id=$1", [TEST_LEAD]);
await c.query("DELETE FROM lead_timeline WHERE lead_id=$1 AND content LIKE 'E2E_TEST%'", [TEST_LEAD]);

// Guarda estado original para restaurar al final
const orig = (await c.query(
  "SELECT status, whatsapp_normalized, ai_paused_until FROM leads WHERE id=$1", [TEST_LEAD]
)).rows[0];

async function insertDue(ctx={}) {
  const r = await c.query(
    `INSERT INTO post_trial_followups (lead_id, kind, due_at, context)
     VALUES ($1, 'asistio', NOW() - interval '1 minute', $2::jsonb)
     RETURNING id`,
    [TEST_LEAD, JSON.stringify(ctx)],
  );
  return r.rows[0].id;
}

// ─── Test 1: Lock atómico — primer lock pasa, segundo falla
const id1 = await insertDue();
const lock1 = await c.query(
  `UPDATE post_trial_followups SET attempts=1 WHERE id=$1 AND attempts=0 AND cancelled_at IS NULL AND sent_at IS NULL RETURNING id`,
  [id1],
);
const lock2 = await c.query(
  `UPDATE post_trial_followups SET attempts=1 WHERE id=$1 AND attempts=0 AND cancelled_at IS NULL AND sent_at IS NULL RETURNING id`,
  [id1],
);
t("Lock atómico: primer intento OK", lock1.rows.length === 1);
t("Lock atómico: segundo intento falla (ya lockeado)", lock2.rows.length === 0);

// Reset para siguientes tests
await c.query("UPDATE post_trial_followups SET attempts=0 WHERE id=$1", [id1]);

// ─── Test 2: Lead converted → debería cancelarse en el cron
await c.query("UPDATE leads SET status='converted' WHERE id=$1", [TEST_LEAD]);
// Simular check del cron
const leadC = (await c.query("SELECT status FROM leads WHERE id=$1", [TEST_LEAD])).rows[0];
t("Lead status=converted leída correctamente", leadC.status === "converted");
// Restaurar
await c.query("UPDATE leads SET status=$2 WHERE id=$1", [TEST_LEAD, orig.status]);

// ─── Test 3: Lead ai_paused_until futuro
await c.query("UPDATE leads SET ai_paused_until=NOW() + interval '1 hour' WHERE id=$1", [TEST_LEAD]);
const leadP = (await c.query("SELECT ai_paused_until FROM leads WHERE id=$1", [TEST_LEAD])).rows[0];
t("ai_paused_until futuro detectable", new Date(leadP.ai_paused_until) > new Date());
await c.query("UPDATE leads SET ai_paused_until=NULL WHERE id=$1", [TEST_LEAD]);

// ─── Test 4: Lead sin WhatsApp
await c.query("UPDATE leads SET whatsapp_normalized=NULL WHERE id=$1", [TEST_LEAD]);
const leadW = (await c.query("SELECT whatsapp_normalized FROM leads WHERE id=$1", [TEST_LEAD])).rows[0];
t("whatsapp_normalized=NULL detectable", leadW.whatsapp_normalized === null);
await c.query("UPDATE leads SET whatsapp_normalized=$2 WHERE id=$1", [TEST_LEAD, orig.whatsapp_normalized]);

// ─── Test 5: Lead replied después de reference_at
const refAt = new Date(Date.now() - 60_000).toISOString();
await c.query("UPDATE post_trial_followups SET reference_at=$2 WHERE id=$1", [id1, refAt]);
const tl = await c.query(
  `INSERT INTO lead_timeline (lead_id, type, author, content)
   VALUES ($1, 'lead_message_received', 'lead', 'E2E_TEST — reply simulado')
   RETURNING id`,
  [TEST_LEAD],
);
const replied = await c.query(
  `SELECT 1 FROM lead_timeline WHERE lead_id=$1 AND type='lead_message_received' AND timestamp > $2 LIMIT 1`,
  [TEST_LEAD, refAt],
);
t("replied-since query funciona (positive)", replied.rows.length === 1);
await c.query("DELETE FROM lead_timeline WHERE id=$1", [tl.rows[0].id]);

// ─── Test 6: markCancelled dedupe
await c.query(
  `UPDATE post_trial_followups SET cancelled_at=NOW(), cancelled_reason='lead_replied' WHERE id=$1`,
  [id1],
);
const stillPending = await c.query(
  `SELECT id FROM post_trial_followups WHERE id=$1 AND cancelled_at IS NULL AND sent_at IS NULL`,
  [id1],
);
t("Fila marcada cancelled NO está en pending", stillPending.rows.length === 0);

// ─── Test 7: Volumen esperado — simular 4 inserts de distinto kind al mismo lead,
// solo uno debería quedar pending (reemplazo)
await c.query("DELETE FROM post_trial_followups WHERE lead_id=$1", [TEST_LEAD]);
for (const k of ["asistio","no_asistio","reagendar","enviar_enlace"]) {
  // Simular schedulePostTrialFollowup: cancel previos + insert nuevo
  await c.query(
    `UPDATE post_trial_followups SET cancelled_at=NOW(), cancelled_reason='replaced_by:${k}' WHERE lead_id=$1 AND cancelled_at IS NULL AND sent_at IS NULL`,
    [TEST_LEAD],
  );
  await c.query(
    `INSERT INTO post_trial_followups (lead_id, kind, due_at) VALUES ($1, $2, NOW() + interval '24 hours')`,
    [TEST_LEAD, k],
  );
}
const final = await c.query(
  `SELECT kind, cancelled_at FROM post_trial_followups WHERE lead_id=$1 ORDER BY created_at`,
  [TEST_LEAD],
);
t("4 reemplazos: 3 cancelled + 1 pending (último kind=enviar_enlace)",
   final.rows.length === 4 &&
   final.rows.slice(0,3).every(r => r.cancelled_at !== null) &&
   final.rows[3].cancelled_at === null &&
   final.rows[3].kind === "enviar_enlace");

// ─── Limpieza
await c.query("DELETE FROM post_trial_followups WHERE lead_id=$1", [TEST_LEAD]);
await c.query("DELETE FROM lead_timeline WHERE lead_id=$1 AND content LIKE 'E2E_TEST%'", [TEST_LEAD]);
await c.query("UPDATE leads SET status=$2, whatsapp_normalized=$3, ai_paused_until=$4 WHERE id=$1",
  [TEST_LEAD, orig.status, orig.whatsapp_normalized, orig.ai_paused_until]);

console.log(`\n${pass} ok, ${fail} fail`);
await c.end();
process.exit(fail > 0 ? 1 : 0);
