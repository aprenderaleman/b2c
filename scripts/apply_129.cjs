// Aplica db/migrations/129 (hitos + plantillas + relabel de garantías) y muestra el resultado.
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
  await c.query("SET client_encoding = 'UTF8'");
  await c.query(fs.readFileSync('db/migrations/129_student_milestones.sql', 'utf8'));
  const t = await c.query(`SELECT kind, sub_n, channel, name FROM message_templates WHERE kind='pack_milestone' ORDER BY channel, sub_n DESC`);
  console.log('plantillas:', t.rows.map(r => `${r.channel}/${r.sub_n}`).join(', '));
  const certs = await c.query(`SELECT u.full_name, c.description, c.extra_label FROM certificates c JOIN students s ON s.id=c.student_id JOIN users u ON u.id=s.user_id WHERE c.type='garantia_nivel' ORDER BY u.full_name`);
  console.log(`\ngarantías relabeladas (${certs.rows.length}):`);
  for (const r of certs.rows) console.log(`  ${r.extra_label} ${r.full_name.padEnd(28)} ${r.description}`);
  await c.end();
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
