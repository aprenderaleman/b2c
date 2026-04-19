#!/usr/bin/env node
/** List every active teacher + student with useful join data. */
import mysql from "mysql2/promise";

const db = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});

// --- 0) Inspect schule_subscriptions schema, since students don't carry subscription info natively
console.log("=== schule_subscriptions columns ===");
const [subCols] = await db.query(`SHOW COLUMNS FROM schule_subscriptions`);
for (const c of subCols) console.log(`  ${c.Field.padEnd(28)} ${c.Type}`);
const [subSample] = await db.query(`SELECT * FROM schule_subscriptions LIMIT 2`);
console.log("sample:", JSON.stringify(subSample, null, 2).slice(0, 1200));

// --- 1) Active teachers
console.log("\n\n=== ACTIVE TEACHERS ===");
const [teachers] = await db.query(`
  SELECT u.id AS user_id, u.fullName, u.email, u.status, u.createdAt,
         t.id AS teacher_id,
         u.additionalInfo
    FROM users u
    JOIN teachers t ON t.id = u.teacherId
   WHERE u.role = 'teacher' AND u.status = 'active'
   ORDER BY u.fullName
`);
console.log(`Total: ${teachers.length}\n`);
for (const t of teachers) {
  console.log(`• ${t.fullName.padEnd(30)} ${t.email.padEnd(40)} created=${t.createdAt.toISOString().slice(0,10)}`);
  if (t.additionalInfo) console.log(`    notes: ${t.additionalInfo.slice(0,100).replace(/\s+/g," ")}`);
}

// --- 2) Active students + their subscriptions + their group assignments
console.log("\n\n=== ACTIVE STUDENTS ===");
const [students] = await db.query(`
  SELECT u.id AS user_id, u.fullName, u.email, u.status, u.createdAt,
         s.id   AS student_id,
         s.level,
         s.classType,
         s.availability,
         u.additionalInfo
    FROM users u
    JOIN students s ON s.id = u.studentId
   WHERE u.role = 'student' AND u.status = 'active'
   ORDER BY u.fullName
`);
console.log(`Total active students: ${students.length}\n`);

// Pull subscriptions per student
const [allSubs] = await db.query(`
  SELECT * FROM schule_subscriptions
`);
// key by userId (most likely link)
const subByUser = new Map();
const subCol = Object.keys(allSubs[0] ?? {}).find(k => /userId|studentId/i.test(k));
if (subCol) {
  for (const s of allSubs) {
    const k = s[subCol];
    if (!subByUser.has(k)) subByUser.set(k, []);
    subByUser.get(k).push(s);
  }
}
console.log(`schule_subscriptions keyed on '${subCol}' — ${subByUser.size} distinct users with ≥1 sub\n`);

// Group memberships via _StudentToStudentGroup (A=studentId, B=groupId)
const [memb] = await db.query(`
  SELECT sg.id AS group_id, sg.name AS group_name, sg.active, sg.classType,
         st.userId AS user_id, sg.teacherId
    FROM _StudentToStudentGroup x
    JOIN student_groups sg ON sg.id = x.B
    JOIN students       st ON st.id = x.A
`);
const groupsByUser = new Map();
for (const m of memb) {
  if (!groupsByUser.has(m.user_id)) groupsByUser.set(m.user_id, []);
  groupsByUser.get(m.user_id).push(m);
}

for (const s of students) {
  const subs = subByUser.get(s.user_id) ?? subByUser.get(s.student_id) ?? [];
  const groups = groupsByUser.get(s.user_id) ?? [];
  const activeGroups = groups.filter(g => g.active);
  console.log(`• ${s.fullName.padEnd(28)} ${s.email.padEnd(38)} lvl=${s.level} type=${s.classType} created=${s.createdAt.toISOString().slice(0,10)}`);
  if (activeGroups.length) {
    for (const g of activeGroups) {
      console.log(`    group: ${g.group_name} (${g.classType})`);
    }
  }
  if (subs.length) {
    for (const sub of subs) {
      const summary = Object.entries(sub)
        .filter(([k,v]) => v !== null && v !== "" && !/^id$|userId|studentId|createdAt|updatedAt/.test(k))
        .map(([k,v]) => `${k}=${String(v).slice(0,40)}`)
        .join(" ");
      console.log(`    sub: ${summary}`);
    }
  }
  if (s.additionalInfo) {
    console.log(`    notes: ${s.additionalInfo.slice(0,120).replace(/\s+/g," ")}`);
  }
}

// --- 3) Stats
console.log("\n\n=== STATS ===");
const [[totals]] = await db.query(`
  SELECT
    (SELECT COUNT(*) FROM users WHERE role='student' AND status='active') AS active_students,
    (SELECT COUNT(*) FROM users WHERE role='student' AND status='inactive') AS inactive_students,
    (SELECT COUNT(*) FROM users WHERE role='teacher' AND status='active') AS active_teachers,
    (SELECT COUNT(*) FROM users WHERE role='teacher' AND status='inactive') AS inactive_teachers,
    (SELECT COUNT(*) FROM users WHERE role='admin' OR role='superadmin') AS admins
`);
console.log(totals);

await db.end();
