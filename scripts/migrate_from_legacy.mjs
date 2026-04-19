#!/usr/bin/env node
/**
 * One-shot migration of the 3 active teachers + 13 real-paying students
 * from the legacy MySQL DB into the new Supabase Postgres schema.
 *
 * Run:
 *   node scripts/migrate_from_legacy.mjs --dry-run    # prints only, no writes
 *   node scripts/migrate_from_legacy.mjs              # real run, one txn
 *
 * Idempotent: re-running is safe. Users are inserted with
 * ON CONFLICT (email) DO NOTHING, students/teachers with ON CONFLICT
 * (user_id) DO NOTHING, groups by legacy_id.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg     = require("pg");
const mysql  = require("mysql2/promise");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry-run");

// ----- load .env (same helper style we use in apply_migrations.mjs) ---------
const envPath = path.join(repoRoot, ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

// ============================================================================
// 1) The hard-coded migration manifest (decisions made with Gelfis).
// ============================================================================

/** Teachers we're bringing over — identified by legacy email. */
const TEACHERS = [
  {
    email: "florian.zormann@gmx.at",
    payment_method: null,
    bio: null,
    languages_spoken: ["de"],
    specialties: [],
    hourly_rate: null,
  },
  {
    email: "coyotemoonyoga@gmail.com",
    payment_method: "IBAN: ES39 2103 5260 9400 1001 8254",
    bio: null,
    languages_spoken: ["de"],
    specialties: [],
    hourly_rate: null,
  },
  {
    email: "Nicaemila2211@gmail.com",
    payment_method:
      "IBAN: PT50 0033 0000 4543 3253 2390 5 | Número da Conta: 454 332 532 39 | NIB: 0033 0000 45433253239 05",
    bio: null,
    languages_spoken: ["de"],
    specialties: [],
    hourly_rate: null,
  },
];

/** Students — legacy_email is used to locate the legacy user/password hash.
 *  override_email lets us correct the Maria Eugenia typo. */
const STUDENTS = [
  // ---- VIP Express (individual)
  { legacy_email: "ahlamsaloui7@gmail.com",
    phone: "+34642516676",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
    extra_notes: "Familiar falleció (abril 2026) — esperando su confirmación para reanudar.",
    monthly_price_cents: null,
  },
  { legacy_email: "xela_cigales@hotmail.es",
    phone: "+34618356447",
    current_level: "B1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
  },
  { legacy_email: "ayman.kayali.lucena@gmail.com",
    phone: "+34693808676",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
  },
  { legacy_email: "ferkeller26@gmail.com",
    phone: "+41784803494",
    current_level: "B1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
  },
  { legacy_email: "mariupp@2016.com",
    override_email: "mariupp2016@gmail.com",       // legacy typo corrected
    phone: "+34610301481",
    current_level: "B1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
    extra_notes: "Pago mensual 450 €/mes · primer pago realizado. Preparación Goethe B1.",
    monthly_price_cents: 45000,
  },
  { legacy_email: "alejokxito@hotmail.com",        // Jeaneth
    phone: "+491632315143",
    current_level: "B2",                            // user override: cancela B1, solo B2
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack VIP Express",
    extra_notes: "Hermana falleció (abril 2026) — pendiente confirmar horarios. Canceló B1, solo B2.",
  },

  // ---- Fluidez Total (grupal)
  { legacy_email: "javiesqueta2203@gmail.com",
    phone: "+34627755453",
    current_level: "A2",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "viverosluisemilio@gmail.com",
    phone: "+41783013957",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "lydia_mendoza@hotmail.com",
    phone: "+34654964129",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "carraasco.nico18@gmail.com",    // Nicolas Abellan
    phone: "+34661881399",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "victoriaavilesgonzalez@gmail.com",
    phone: "+41767285856",
    current_level: "A2",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "catalan_640@hotmail.com",       // Francisco
    phone: "+491628345700",
    current_level: "A2",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
  { legacy_email: "natalia.paniagua.casas@gmail.com",
    phone: "+34650922123",
    current_level: "A1",
    subscription_type: "package",
    subscription_status: "active",
    pack_name: "Pack Fluidez Total",
  },
];

// ============================================================================
// 2) Connect to both DBs
// ============================================================================

const legacy = await mysql.createConnection({
  host: "62.146.225.25", port: 3307,
  user: "aprenderaleman", password: "XcxWKWLXfKOuiIvm",
  database: "aprenderaleman",
});

const pgClient = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();

console.log(DRY ? "📋 DRY-RUN — no writes will happen\n" : "⚙️  LIVE RUN — writing to Supabase\n");

// ============================================================================
// 3) Pull all legacy rows we'll need, in one shot
// ============================================================================

const allTeacherEmails = TEACHERS.map(t => t.email.toLowerCase());
const allStudentEmails = STUDENTS.map(s => s.legacy_email.toLowerCase());
const allEmails        = [...allTeacherEmails, ...allStudentEmails];

const [legacyUsers] = await legacy.query(
  `SELECT id, fullName, email, password, role, status, teacherId, studentId, additionalInfo, createdAt
     FROM users
    WHERE LOWER(email) IN (${allEmails.map(() => "?").join(",")})`,
  allEmails,
);
const legacyUserByEmail = new Map(
  legacyUsers.map(u => [u.email.toLowerCase(), u])
);

// Fetch teacher-row mappings so we can translate legacy.teacherId → our new teacher.id later
const [legacyTeacherRows] = await legacy.query(
  `SELECT t.id AS teacher_id, t.userId AS user_id, u.email
     FROM teachers t JOIN users u ON u.id = t.userId`,
);
const legacyTeacherByLegacyId = new Map(
  legacyTeacherRows.map(t => [t.teacher_id, t]),
);

// Fetch all active groups that contain any of our 13 students.
const [legacyStudentRows] = await legacy.query(
  `SELECT s.id AS student_id, s.userId, s.level, s.classType, s.availability, u.email
     FROM students s JOIN users u ON u.id = s.userId
    WHERE LOWER(u.email) IN (${allStudentEmails.map(() => "?").join(",")})`,
  allStudentEmails,
);
const legacyStudentIdByEmail = new Map(
  legacyStudentRows.map(s => [s.email.toLowerCase(), s.student_id]),
);
const legacyStudentIds = legacyStudentRows.map(s => s.student_id);

const [legacyGroups] = await legacy.query(
  `SELECT DISTINCT sg.id, sg.name, sg.capacity, sg.classType, sg.startDate, sg.endDate,
                    sg.teacherId, sg.meetLink, sg.documentUrl, sg.active
     FROM student_groups sg
     JOIN _StudentToStudentGroup x ON x.B = sg.id
    WHERE sg.active = 1 AND x.A IN (${legacyStudentIds.map(() => "?").join(",")})`,
  legacyStudentIds,
);

const [legacyMemberships] = await legacy.query(
  `SELECT x.A AS student_id, x.B AS group_id
     FROM _StudentToStudentGroup x
    WHERE x.A IN (${legacyStudentIds.map(() => "?").join(",")})
      AND x.B IN (${legacyGroups.map(() => "?").join(",") || "NULL"})`,
  [...legacyStudentIds, ...legacyGroups.map(g => g.id)],
);

console.log(
  `legacy: ${legacyUsers.length} users, ${legacyGroups.length} active groups, ` +
  `${legacyMemberships.length} memberships`
);

// ============================================================================
// 4) Sanity checks BEFORE opening the txn
// ============================================================================

for (const t of TEACHERS) {
  if (!legacyUserByEmail.has(t.email.toLowerCase())) {
    console.error(`✗ missing legacy user for teacher ${t.email}`); process.exit(1);
  }
}
for (const s of STUDENTS) {
  if (!legacyUserByEmail.has(s.legacy_email.toLowerCase())) {
    console.error(`✗ missing legacy user for student ${s.legacy_email}`); process.exit(1);
  }
}
console.log("✓ all legacy users present");

// ============================================================================
// 5) Insert teachers → users + teachers
// ============================================================================

async function pgQuery(text, params) {
  if (DRY) {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    console.log(`  [dry] ${preview} …`);
    return { rows: [], rowCount: 0 };
  }
  return pgClient.query(text, params);
}

if (!DRY) await pgClient.query("BEGIN");

// Map legacy_user_id → new_user_id (fill as we insert)
const newUserIdByLegacyUserId = new Map();
const newTeacherIdByLegacyTeacherId = new Map();
const newStudentIdByLegacyStudentId = new Map();

// --- teachers
console.log("\n── inserting teachers ──");
for (const t of TEACHERS) {
  const lu = legacyUserByEmail.get(t.email.toLowerCase());
  const email = lu.email.toLowerCase();
  console.log(`• ${lu.fullName} (${email})`);

  const userRes = await pgQuery(
    `INSERT INTO users (email, password_hash, role, full_name, phone, language_preference, active)
     VALUES ($1, $2, 'teacher', $3, $4, 'es', TRUE)
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [email, lu.password, lu.fullName, null],
  );
  const newUserId = DRY ? "dry-user-" + email : userRes.rows[0].id;
  newUserIdByLegacyUserId.set(lu.id, newUserId);

  const teaRes = await pgQuery(
    `INSERT INTO teachers (user_id, bio, languages_spoken, specialties, hourly_rate, currency,
                           payment_method, active)
     VALUES ($1, $2, $3, $4, $5, 'EUR', $6, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [newUserId, t.bio, t.languages_spoken, t.specialties, t.hourly_rate, t.payment_method],
  );
  const newTeacherId = DRY ? "dry-teacher-" + email : teaRes.rows[0].id;

  // map legacy teacher id → new teacher id
  const lteacher = legacyTeacherRows.find(lt => lt.user_id === lu.id);
  if (lteacher) newTeacherIdByLegacyTeacherId.set(lteacher.teacher_id, newTeacherId);
}

// --- students
console.log("\n── inserting students ──");
for (const s of STUDENTS) {
  const lu = legacyUserByEmail.get(s.legacy_email.toLowerCase());
  const finalEmail = (s.override_email ?? lu.email).toLowerCase();
  console.log(`• ${lu.fullName} → ${finalEmail}  [${s.pack_name}, ${s.current_level}]`);

  // Compose notes: legacy additionalInfo + Pack + extras
  const parts = [
    `${s.pack_name}`,
    lu.additionalInfo?.trim(),
    s.extra_notes?.trim(),
  ].filter(Boolean);
  const notes = parts.join(" · ");

  const userRes = await pgQuery(
    `INSERT INTO users (email, password_hash, role, full_name, phone, language_preference, active)
     VALUES ($1, $2, 'student', $3, $4, 'es', TRUE)
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [finalEmail, lu.password, lu.fullName, s.phone ?? null],
  );
  const newUserId = DRY ? "dry-user-" + finalEmail : userRes.rows[0].id;
  newUserIdByLegacyUserId.set(lu.id, newUserId);

  const studRes = await pgQuery(
    `INSERT INTO students
        (user_id, current_level, subscription_type, subscription_status,
         classes_remaining, classes_per_month, monthly_price_cents, currency, notes)
     VALUES ($1, $2::cefr_level, $3::subscription_type, $4::subscription_status,
             0, NULL, $5, 'EUR', $6)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [newUserId, s.current_level, s.subscription_type, s.subscription_status,
     s.monthly_price_cents ?? null, notes],
  );
  const newStudentId = DRY ? "dry-student-" + finalEmail : studRes.rows[0].id;

  const lsid = legacyStudentIdByEmail.get(s.legacy_email.toLowerCase());
  if (lsid) newStudentIdByLegacyStudentId.set(lsid, newStudentId);
}

// ============================================================================
// 6) Groups + memberships
// ============================================================================

console.log("\n── inserting student_groups ──");

/** Ensure every group we're about to insert has its teacher already migrated. */
function levelFromGroupName(name) {
  const m = name.match(/\b([AB][12])\b/i);
  return m ? m[1].toUpperCase() : null;
}

// If a legacy group refers to a teacher we didn't migrate (only 3 of 5 came
// over), we INSERT the group with teacher_id = NULL rather than failing.
for (const g of legacyGroups) {
  const newTeacherId = newTeacherIdByLegacyTeacherId.get(g.teacherId) ?? null;
  const lvl = levelFromGroupName(g.name);
  console.log(`• [${g.classType}] ${g.name}  lvl=${lvl ?? "—"}  teacher=${newTeacherId ? "ok" : "NULL"}`);

  await pgQuery(
    `INSERT INTO student_groups
        (legacy_id, name, capacity, class_type, level, teacher_id,
         start_date, end_date, meet_link, document_url, active)
     VALUES ($1, $2, $3, $4::class_type, $5::cefr_level, $6,
             $7, $8, $9, $10, TRUE)
     ON CONFLICT (legacy_id) DO UPDATE SET
         name         = EXCLUDED.name,
         capacity     = EXCLUDED.capacity,
         teacher_id   = EXCLUDED.teacher_id,
         level        = EXCLUDED.level,
         start_date   = EXCLUDED.start_date,
         end_date     = EXCLUDED.end_date,
         meet_link    = EXCLUDED.meet_link,
         document_url = EXCLUDED.document_url,
         active       = EXCLUDED.active,
         updated_at   = now()`,
    [
      g.id, g.name, g.capacity, g.classType, lvl, newTeacherId,
      g.startDate ? new Date(g.startDate) : null,
      g.endDate   ? new Date(g.endDate)   : null,
      g.meetLink, g.documentUrl,
    ],
  );
}

// --- memberships
console.log("\n── inserting student_group_members ──");
let skippedBecauseGelfis = 0;
for (const m of legacyMemberships) {
  const newStudentId = newStudentIdByLegacyStudentId.get(m.student_id);
  if (!newStudentId) { skippedBecauseGelfis++; continue; }

  // Look up the new group id by legacy_id
  if (DRY) {
    console.log(`  [dry] student ${m.student_id} → group ${m.group_id}`);
    continue;
  }
  await pgClient.query(
    `INSERT INTO student_group_members (group_id, student_id)
     SELECT id, $1::uuid FROM student_groups WHERE legacy_id = $2
     ON CONFLICT DO NOTHING`,
    [newStudentId, m.group_id],
  );
}
if (skippedBecauseGelfis) {
  console.log(`  (skipped ${skippedBecauseGelfis} memberships belonging to legacy users we didn't migrate — e.g. Gelfis test account)`);
}

// ============================================================================
// 7) Commit or rollback
// ============================================================================
if (!DRY) {
  await pgClient.query("COMMIT");
  console.log("\n✓ transaction committed");
}

// ============================================================================
// 8) Verification
// ============================================================================
if (!DRY) {
  const { rows: counts } = await pgClient.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='teacher') AS teachers,
      (SELECT COUNT(*) FROM users WHERE role='student') AS students,
      (SELECT COUNT(*) FROM student_groups)             AS groups,
      (SELECT COUNT(*) FROM student_group_members)      AS memberships
  `);
  console.log("\n=== verification ===", counts[0]);
}

await legacy.end();
await pgClient.end();
