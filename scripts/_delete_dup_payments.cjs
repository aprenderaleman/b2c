// Borra pagos duplicados:
//  (a) registros SIN referencia Stripe que tienen un gemelo referenciado (mismo alumno, importe, ±7 días)
//  (b) registros con el MISMO id base de Stripe (ch_/pi_/py_) y ambos 'paid' → se borra la copia más reciente
// Los pares paid+refunded con mismo id NO se tocan, solo se listan.
const fs = require('fs');
const pg = require('pg');
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

c.connect().then(async () => {
  const dups = await c.query(`
    SELECT a.id, u.full_name, a.amount_cents, to_char(a.paid_at,'YYYY-MM-DD') d
    FROM payments a
    JOIN payments b ON b.student_id=a.student_id AND b.id<>a.id AND b.amount_cents=a.amount_cents
         AND (b.stripe_charge_id IS NOT NULL OR b.stripe_payment_intent_id IS NOT NULL)
         AND abs(extract(epoch from (a.paid_at-b.paid_at))) < 7*86400
    JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id
    WHERE a.stripe_charge_id IS NULL AND a.stripe_payment_intent_id IS NULL`);
  for (const r of dups.rows) {
    await c.query(`DELETE FROM payments WHERE id=$1`, [r.id]);
    console.log(`BORRADO (sin ref): ${r.full_name} ${r.d} ${r.amount_cents/100}€`);
  }

  const d2 = await c.query(`
    SELECT u.full_name, p.amount_cents, regexp_replace(COALESCE(p.stripe_charge_id,p.stripe_payment_intent_id),'^(ch|pi|py)_','') base,
           array_agg(p.id::text ORDER BY p.created_at) ids, array_agg(p.status::text ORDER BY p.created_at) st, array_agg(to_char(p.paid_at,'MM-DD') ORDER BY p.created_at) ds
    FROM payments p JOIN students s ON s.id=p.student_id JOIN users u ON u.id=s.user_id
    WHERE COALESCE(p.stripe_charge_id,p.stripe_payment_intent_id) IS NOT NULL
    GROUP BY 1,2,3 HAVING COUNT(*)>1`);
  for (const r of d2.rows) {
    if (r.st.every(s => s === 'paid')) {
      for (const id of r.ids.slice(1)) await c.query(`DELETE FROM payments WHERE id=$1`, [id]);
      console.log(`BORRADO (mismo id Stripe): ${r.full_name} ${r.amount_cents/100}€ ${r.base.substring(0,20)} (${r.ids.length-1} copia/s)`);
    } else {
      console.log(`REVISAR (paid+refunded mismo id): ${r.full_name} ${r.amount_cents/100}€ ${r.st.join('/')} ${r.ds.join('/')}`);
    }
  }
  await c.end();
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
