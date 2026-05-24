// Sube los 70 PDFs premium a R2 + inserta en teacher_resources.
// Limpia previamente los 42 recursos antiguos.
// Visibilidad: profesores + alumnos.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { LECCIONES_V2 } from "./lecciones-v2.mjs";

const require = createRequire(import.meta.url);
const pg = require("pg");

const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
  env[m[1]] = v;
}

const ROOT = "C:/Users/gelfi/Desktop/b2c/materiales-premium-all";

// ── R2 client ───────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = env.R2_BUCKET;
const ACCOUNT_ID = env.R2_ACCOUNT_ID;

// ── PG client ───────────────────────────────────────────────
const pgc = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();

// ── Topics / títulos en español para la UI ──────────────────
const TOPIC_BY_LEVEL = {
  A0: "principiantes", A1: "básico (A1)", A2: "elemental (A2)",
  B1: "intermedio (B1)", B2: "intermedio alto (B2)",
  C1: "avanzado (C1)",  C2: "maestría (C2)",
};

// ── Teacher uploader = Gelfis ───────────────────────────────
const { rows: ts } = await pgc.query(
  `SELECT t.id FROM teachers t JOIN users u ON u.id=t.user_id WHERE u.email='aprenderaleman2026@gmail.com' LIMIT 1`,
);
if (ts.length === 0) { console.error("✗ teacher Gelfis no encontrado"); process.exit(1); }
const uploaderId = ts[0].id;
console.log(`Uploader: ${uploaderId}`);

// ── 1) Limpiar los 42 recursos antiguos (BD + R2 best-effort) ──
console.log("\n── Limpiando recursos antiguos ──");
const { rows: old } = await pgc.query(
  `SELECT id, storage_key FROM teacher_resources WHERE storage_key LIKE 'teacher-resources/${uploaderId}/seed-%'`,
);
console.log(`  Encontrados: ${old.length} recursos antiguos.`);
let r2DelOk = 0, r2DelErr = 0;
for (const r of old) {
  if (r.storage_key) {
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: r.storage_key }));
      r2DelOk++;
    } catch { r2DelErr++; }
  }
}
const delResult = await pgc.query(
  `DELETE FROM teacher_resources WHERE storage_key LIKE 'teacher-resources/${uploaderId}/seed-%'`,
);
console.log(`  R2 borrados: ${r2DelOk} ok / ${r2DelErr} error.`);
console.log(`  BD borradas: ${delResult.rowCount} filas.`);

// ── 2) Subir 70 PDFs nuevos + insertar ───────────────────────
console.log("\n── Subiendo 70 PDFs nuevos ──");
let uploaded = 0;
for (const L of LECCIONES_V2) {
  const pdfPath = path.join(ROOT, L.level, `${L.level}-${String(L.n).padStart(2,"0")}-${L.slug}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    console.warn(`  ✗ no existe: ${pdfPath}`);
    continue;
  }
  const buf = fs.readFileSync(pdfPath);
  const key = `teacher-resources/${uploaderId}/seed-${Date.now()}-${L.level}-${String(L.n).padStart(2,"0")}-${L.slug}.pdf`;

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf, ContentType: "application/pdf",
  }));
  const fileUrl = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;

  const title = `${L.level} · Lektion ${L.n} — ${L.title}`;
  const description =
    `Lección oficial nivel ${L.level} (lección ${L.n} de 10). Incluye: objetivos, vocabulario, gramática + ` +
    `caja destacada${L.grammarSpanishKey ? " + clave en español" : ""}, ejemplos reales, mini-diálogo "${L.inPractice?.title ?? "In der Praxis"}", ` +
    `errores comunes del hispanohablante, ejercicio guiado, hausaufgabe y resumen.`;
  const tags = ["oficial", "lección", L.level.toLowerCase(), L.slug, "presentación"];

  await pgc.query(`
    INSERT INTO teacher_resources
      (uploaded_by, title, description, level, topic, kind,
       file_url, file_name, file_size_bytes, storage_key, tags, student_visible)
    VALUES ($1,$2,$3,$4,$5,'pdf',$6,$7,$8,$9,$10,true)`,
    [
      uploaderId, title, description, L.level, TOPIC_BY_LEVEL[L.level],
      fileUrl, path.basename(pdfPath), buf.length, key, tags,
    ],
  );
  uploaded++;
  if (uploaded % 10 === 0) console.log(`  ${uploaded}/70 subidos`);
}

// ── 3) Verificación final ────────────────────────────────────
const { rows: count } = await pgc.query(
  `SELECT level, COUNT(*) AS n FROM teacher_resources WHERE storage_key LIKE 'teacher-resources/${uploaderId}/seed-%' GROUP BY level ORDER BY level`,
);
console.log(`\n── Estado final en BD ──`);
for (const r of count) console.log(`  ${r.level}: ${r.n} recursos`);
const total = count.reduce((s,r) => s + Number(r.n), 0);
console.log(`  TOTAL: ${total} recursos visibles a profes + alumnos`);

await pgc.end();
console.log("\n✔ Done.");
