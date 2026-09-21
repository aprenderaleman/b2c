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
  await c.query(fs.readFileSync('db/migrations/130_admin_google_credentials.sql', 'utf8'));
  const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='admin_google_credentials' ORDER BY ordinal_position`);
  console.log('admin_google_credentials:', r.rows.map(x => x.column_name).join(', '));
  await c.end();
}).catch(e => { console.error('ERR:', e.message); process.exit(1); });
