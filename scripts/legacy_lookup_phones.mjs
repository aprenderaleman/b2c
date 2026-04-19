#!/usr/bin/env node
/**
 * Match each of the 13 students we're migrating against the legacy `leads`
 * table to pull their phone numbers. Match strategy:
 *   1) exact email match (case-insensitive)
 *   2) fuzzy name match (first-word-of-fullName contained in lead.name)
 *
 * Read-only — no writes anywhere.
 */
import mysql from "mysql2/promise";

const db = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});

// 0) Inspect the leads table to see available phone-related columns
const [cols] = await db.query(`SHOW COLUMNS FROM leads`);
console.log("leads columns:");
for (const c of cols) console.log(`  ${c.Field.padEnd(28)} ${c.Type}`);

// 1) Pull the 13 students we're migrating
const [students] = await db.query(`
  SELECT u.id AS user_id, u.fullName, u.email
    FROM users u
    JOIN students s ON s.id = u.studentId
   WHERE u.role = 'student' AND u.status = 'active'
     AND u.email IN (
       'ahlamsaloui7@gmail.com',
       'xela_cigales@hotmail.es',
       'ayman.kayali.lucena@gmail.com',
       'ferkeller26@gmail.com',
       'mariupp@2016.com',
       'javiesqueta2203@gmail.com',
       'viverosluisemilio@gmail.com',
       'lydia_mendoza@hotmail.com',
       'carraasco.nico18@gmail.com',
       'victoriaavilesgonzalez@gmail.com',
       'catalan_640@hotmail.com',
       'alejokxito@hotmail.com',
       'natalia.paniagua.casas@gmail.com'
     )
`);
console.log(`\nStudents to match: ${students.length}`);

// 2) For each, try email match first, then fuzzy name
const results = [];
for (const s of students) {
  let phone = null, matched_on = null, lead_row = null;

  // exact email match
  const [byEmail] = await db.query(
    `SELECT id, fullName, email, phone, germanLevel, status, convertedToUser, createdAt
       FROM leads WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [s.email],
  );
  if (byEmail.length) { lead_row = byEmail[0]; matched_on = "email"; }

  // fall back to convertedToUser match
  if (!lead_row) {
    const [byConv] = await db.query(
      `SELECT id, fullName, email, phone, germanLevel, status, convertedToUser, createdAt
         FROM leads WHERE convertedToUser = ? LIMIT 1`,
      [s.user_id],
    );
    if (byConv.length) { lead_row = byConv[0]; matched_on = "convertedToUser"; }
  }

  // fall back to first-word-of-name
  if (!lead_row) {
    const firstWord = String(s.fullName).trim().split(/\s+/)[0];
    if (firstWord && firstWord.length >= 3) {
      const [byName] = await db.query(
        `SELECT id, fullName, email, phone, germanLevel, status, convertedToUser, createdAt
           FROM leads
          WHERE fullName LIKE ?
          ORDER BY createdAt DESC
          LIMIT 3`,
        [`%${firstWord}%`],
      );
      if (byName.length) { lead_row = byName[0]; matched_on = `name~${firstWord}`; }
    }
  }

  phone = lead_row?.phone || null;
  results.push({ student: s.fullName, email: s.email, phone, matched_on, lead_name: lead_row?.fullName ?? null, lead_email: lead_row?.email ?? null });
}

// 3) Report
console.log("\n=== PHONES FOUND ===\n");
for (const r of results) {
  const status = r.phone ? "✓" : "✗";
  console.log(
    `${status} ${r.student.padEnd(26)} ${r.email.padEnd(38)} ` +
    `phone=${(r.phone ?? "NONE").padEnd(18)} via=${(r.matched_on ?? "—").padEnd(18)} lead=${r.lead_name ?? "—"} (${r.lead_email ?? "—"})`
  );
}

const missing = results.filter(r => !r.phone);
console.log(`\nMatched ${results.length - missing.length}/${results.length}. Missing: ${missing.length}.`);

await db.end();
