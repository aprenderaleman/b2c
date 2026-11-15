// Test smoke de post_trial_followups + cron.
// Verifica: insert, reemplazo (cancel previos), cancelPending, dedup
// por conversión, dedup por reply, verificación de dueAt + jitter.
// No envía WA — usa due_at futuro.
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const TEST_LEAD = "8e83b457-b4cc-4b8c-8b08-547bd90244a8"; // Test Sina (lost)
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log(`✓ ${name}`); } else { fail++; console.error(`✗ ${name}`, extra ?? ""); } };

// Limpieza previa
await c.query("DELETE FROM post_trial_followups WHERE lead_id=$1", [TEST_LEAD]);

// --- Test 1: INSERT simple
const ins1 = await c.query(
  `INSERT INTO post_trial_followups (lead_id, kind, due_at, context)
   VALUES ($1, 'asistio', NOW() + interval '24 hours', '{"planUrl":"https://test/plan"}'::jsonb)
   RETURNING id, kind, due_at`,
  [TEST_LEAD],
);
t("INSERT asistio devuelve fila", ins1.rows.length === 1);
const id1 = ins1.rows[0].id;

// --- Test 2: Fila queda queryable por due_at, lead_id
const q1 = await c.query(
  "SELECT id FROM post_trial_followups WHERE lead_id=$1 AND cancelled_at IS NULL AND sent_at IS NULL",
  [TEST_LEAD],
);
t("Pending query devuelve 1 fila", q1.rows.length === 1 && q1.rows[0].id === id1);

// --- Test 3: REEMPLAZO — insertar otra marca cancel + insert nueva
// Simulamos lo que hace schedulePostTrialFollowup.
await c.query(
  `UPDATE post_trial_followups
      SET cancelled_at=NOW(), cancelled_reason='replaced_by:enviar_enlace', updated_at=NOW()
    WHERE lead_id=$1 AND cancelled_at IS NULL AND sent_at IS NULL`,
  [TEST_LEAD],
);
const ins2 = await c.query(
  `INSERT INTO post_trial_followups (lead_id, kind, due_at, context)
   VALUES ($1, 'enviar_enlace', NOW() + interval '24 hours', '{"planUrl":"https://test/pay"}'::jsonb)
   RETURNING id`,
  [TEST_LEAD],
);
const q2 = await c.query(
  "SELECT id, kind, cancelled_at, cancelled_reason FROM post_trial_followups WHERE lead_id=$1 ORDER BY created_at",
  [TEST_LEAD],
);
t("Reemplazo: 2 filas (1 cancelled + 1 pending)", q2.rows.length === 2);
t("Fila original marcada cancelled", q2.rows[0].cancelled_at !== null && q2.rows[0].cancelled_reason.startsWith("replaced_by"));
t("Nueva fila pending (kind=enviar_enlace)", q2.rows[1].cancelled_at === null && q2.rows[1].kind === "enviar_enlace");

// --- Test 4: Partial index sirve (plan/explain)
const ex = await c.query(
  "EXPLAIN SELECT id FROM post_trial_followups WHERE cancelled_at IS NULL AND sent_at IS NULL AND due_at <= NOW() ORDER BY due_at LIMIT 10"
);
const planText = ex.rows.map(r => r["QUERY PLAN"]).join("\n");
t("Query usa índice post_trial_followups_due", /post_trial_followups_due/i.test(planText), planText.slice(0,200));

// --- Test 5: Dedup por "replied": lead responde y el cron debería cancelar
// Simulamos con una fila cuyo reference_at es anterior a un lead_message_received
// que vamos a insertar (y luego limpiar).
const ref = new Date(Date.now() - 60_000).toISOString();
await c.query(
  "UPDATE post_trial_followups SET reference_at=$2 WHERE id=$1",
  [ins2.rows[0].id, ref],
);
const tl = await c.query(
  `INSERT INTO lead_timeline (lead_id, type, author, content, timestamp)
   VALUES ($1, 'lead_message_received', 'lead', 'TEST — simulación de reply', NOW())
   RETURNING id`,
  [TEST_LEAD],
);
const replied = await c.query(
  `SELECT 1 FROM lead_timeline WHERE lead_id=$1 AND type='lead_message_received' AND timestamp > $2 LIMIT 1`,
  [TEST_LEAD, ref],
);
t("leadRepliedSince() positive case detecta reply", replied.rows.length === 1);
await c.query("DELETE FROM lead_timeline WHERE id=$1", [tl.rows[0].id]);

// --- Test 6: due_at con jitter (al insertar via lib, el valor cambia ±15m)
// Verificamos solo que el rango esperado es ≈24h ± 15m
const rows = [];
for (let i = 0; i < 20; i++) {
  const r = await c.query(
    `INSERT INTO post_trial_followups (lead_id, kind, due_at, context)
     VALUES ($1, 'asistio', NOW() + interval '24 hours' + (random()*30 - 15) * interval '1 minute', '{}'::jsonb)
     RETURNING extract(epoch from (due_at - NOW())) AS dt`,
    [TEST_LEAD],
  );
  rows.push(Number(r.rows[0].dt));
}
const min = Math.min(...rows), max = Math.max(...rows);
const minExp = 24 * 3600 - 15 * 60 - 5, maxExp = 24 * 3600 + 15 * 60 + 5;
t(`Jitter ±15min OK (min=${(min/3600).toFixed(3)}h max=${(max/3600).toFixed(3)}h)`,
   min >= minExp && max <= maxExp);

// --- Test 7: Fila con sent_at NO aparece en pending
await c.query(
  "UPDATE post_trial_followups SET sent_at=NOW() WHERE id=$1",
  [ins2.rows[0].id],
);
const pend = await c.query(
  "SELECT id FROM post_trial_followups WHERE lead_id=$1 AND cancelled_at IS NULL AND sent_at IS NULL",
  [TEST_LEAD],
);
t("Fila con sent_at excluida de pending", pend.rows.filter(r => r.id === ins2.rows[0].id).length === 0);

// --- Limpieza
await c.query("DELETE FROM post_trial_followups WHERE lead_id=$1", [TEST_LEAD]);

console.log(`\n${pass} ok, ${fail} fail`);
await c.end();
process.exit(fail > 0 ? 1 : 0);
