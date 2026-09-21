// Aplica db/migrations/131 y muestra los agendables de los packs antes → después.
const fs=require('fs'),pg=require('pg');const env={};
for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);env[m[1]]=v;}
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const Q=`SELECT u.full_name, s.classes_per_month cpm, s.classes_remaining rem, s.clases_desbloqueadas desbl,
  (SELECT COALESCE(SUM(cl.billed_hours),0) FROM class_participants cp JOIN classes cl ON cl.id=cp.class_id WHERE cp.student_id=s.id AND cl.status='completed' AND cl.billed_hours>0) cons,
  (SELECT COUNT(*) FROM class_participants cp JOIN classes cl ON cl.id=cp.class_id WHERE cp.student_id=s.id AND cl.status='scheduled' AND cl.scheduled_at>=now()) agend
  FROM students s JOIN users u ON u.id=s.user_id WHERE u.active AND s.subscription_type IS DISTINCT FROM 'monthly_subscription' ORDER BY u.full_name`;
const disp=x=>{let d=x.desbl-x.cons-x.agend;if(x.cpm>0)d=Math.min(d,x.cpm);return Math.max(0,Math.min(d,x.rem));};
c.connect().then(async()=>{
  const before=(await c.query(Q)).rows;
  await c.query(fs.readFileSync('db/migrations/131_pack_desbloqueadas_sync.sql','utf8'));
  const after=(await c.query(Q)).rows;
  for(const a of after){const b=before.find(x=>x.full_name===a.full_name);
    console.log(`${a.full_name.padEnd(27)} restantes=${String(a.rem).padStart(2)} ya agendadas=${String(a.agend).padStart(2)} | agendables ${String(disp(b)).padStart(2)} → ${String(disp(a)).padStart(2)}`);}
  await c.end();
}).catch(e=>{console.error('ERR:',e.message);process.exit(1)});
