// Aplica db/migrations/128 y verifica que los saldos no cambian.
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
const SNAP = `SELECT u.full_name, s.clases_totales, s.classes_purchased, s.classes_adjustment, s.classes_remaining
  FROM students s JOIN users u ON u.id=s.user_id WHERE u.active=true ORDER BY u.full_name`;

c.connect().then(async () => {
  const before = (await c.query(SNAP)).rows;
  await c.query(fs.readFileSync('db/migrations/128_clases_totales_source_of_truth.sql', 'utf8'));
  const after = (await c.query(SNAP)).rows;
  console.log('nombre | totales purch adj rem  →  totales purch adj rem');
  let diffs = 0;
  for (let i = 0; i < after.rows?.length ?? after.length; i++) {}
  for (const a of after) {
    const b = before.find(x => x.full_name === a.full_name) || {};
    const changed = b.classes_remaining !== a.classes_remaining;
    if (changed) diffs++;
    console.log(`${a.full_name.padEnd(28)} ${b.clases_totales}/${b.classes_purchased}/${b.classes_adjustment}/${b.classes_remaining}  →  ${a.clases_totales}/${a.classes_purchased}/${a.classes_adjustment}/${a.classes_remaining}${changed ? '   *** CAMBIÓ ***' : ''}`);
  }
  console.log(`\nsaldos cambiados: ${diffs} (esperado 0)`);
  await c.end();
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
