#!/usr/bin/env node
/**
 * Second pass: for the 7 students where v1 matched the wrong lead, search
 * leads more precisely using the last-name and the email local-part. Also
 * dump users.additionalInfo for each, in case a phone lives there.
 */
import mysql from "mysql2/promise";

const db = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});

const TARGETS = [
  { fullName: "Nicolas Abellan",     email: "carraasco.nico18@gmail.com", anchors: ["Abellan", "carraasco", "nico18"] },
  { fullName: "Francisco",           email: "catalan_640@hotmail.com",    anchors: ["catalan_640", "Francisco"] },
  { fullName: "Fernanda Keller",     email: "ferkeller26@gmail.com",      anchors: ["Keller", "ferkeller"] },
  { fullName: "Javier Esqueta",      email: "javiesqueta2203@gmail.com",  anchors: ["Esqueta", "javiesqueta"] },
  { fullName: "Maria Eugenia",       email: "mariupp@2016.com",           anchors: ["mariupp", "Eugenia"] },
  { fullName: "Victoria",            email: "victoriaavilesgonzalez@gmail.com", anchors: ["Aviles", "victoriaaviles"] },
  { fullName: "Luis Emilio",         email: "viverosluisemilio@gmail.com", anchors: ["Viveros", "Emilio", "viveros"] },
];

for (const t of TARGETS) {
  console.log(`\n\n══ ${t.fullName} (${t.email}) ══`);

  // A) the legacy users.additionalInfo of the user themselves
  const [uRows] = await db.query(
    `SELECT id, fullName, additionalInfo FROM users WHERE email = ?`, [t.email]
  );
  if (uRows.length) {
    const info = uRows[0].additionalInfo ?? "";
    const phoneInInfo = info.match(/\+?\d[\d\s().-]{7,}\d/);
    console.log(`  users.additionalInfo → ${phoneInInfo ? "PHONE IN NOTE: " + phoneInInfo[0] : "(no phone-like string)"}`);
    if (info.trim()) console.log(`    note: ${info.slice(0,140).replace(/\s+/g," ")}`);
  }

  // B) exact email match in leads
  const [byEmail] = await db.query(
    `SELECT id, fullName, email, phone FROM leads WHERE LOWER(email) = LOWER(?)`,
    [t.email],
  );
  console.log(`  leads by exact email: ${byEmail.length}`);
  for (const r of byEmail) console.log(`    → ${r.fullName} (${r.email}) phone=${r.phone}`);

  // C) search each anchor in fullName / email / notes
  for (const anchor of t.anchors) {
    const [rows] = await db.query(
      `SELECT id, fullName, email, phone
         FROM leads
        WHERE fullName LIKE ? OR email LIKE ? OR notes LIKE ?
        ORDER BY createdAt DESC
        LIMIT 5`,
      [`%${anchor}%`, `%${anchor}%`, `%${anchor}%`],
    );
    if (rows.length) {
      console.log(`  anchor "${anchor}" → ${rows.length} hit(s):`);
      for (const r of rows) console.log(`    • ${r.fullName} | ${r.email || "—"} | phone=${r.phone || "—"}`);
    }
  }
}

await db.end();
