// Sube los 14 PDFs generados en /materiales/ a R2 e inserta filas en
// teacher_resources. Idempotente: si ya existe un recurso con el
// mismo título, lo salta.
//
// Uploaded_by: requiere un teacher de la BD. Por defecto usa la
// cuenta "academia" (Gelfis). Si no existe, el primer teacher
// activo.
//
// Uso:  node scripts/seed_teacher_resources.mjs

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { LECCIONES } = await import("./materiales/lecciones.mjs");

const env = {};
for (const l of fs.readFileSync("C:/Users/gelfi/Desktop/b2c/.env","utf8").split(/\r?\n/)) {
  const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(!m) continue;
  let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  env[m[1]]=v;
}

// R2 client
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = env.R2_BUCKET || "aprender-aleman-recordings";
const ACCOUNT_ID = env.R2_ACCOUNT_ID;

// PG client
const pgc = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();

// Resolver el teacher_id de Gelfis (uploader por defecto)
const { rows: ts } = await pgc.query(`
  SELECT t.id, u.full_name, u.email FROM teachers t JOIN users u ON u.id=t.user_id
   WHERE u.email='aprenderaleman2026@gmail.com'
   LIMIT 1`);
const uploaderId = ts[0]?.id;
if (!uploaderId) { console.error("✗ teacher Gelfis no encontrado"); process.exit(1); }
console.log(`Uploader: ${ts[0].full_name} (${uploaderId.slice(0,8)})`);

const ROOT = "C:/Users/gelfi/Desktop/b2c/materiales";

let uploaded = 0, skipped = 0;
for (const L of LECCIONES) {
  const pdfPath = path.join(ROOT, L.level, `${L.level}-leccion-${L.n}-${L.slug}-presentacion.pdf`);
  if (!fs.existsSync(pdfPath)) {
    console.warn(`  ✗ no existe: ${pdfPath} — generate primero`);
    continue;
  }

  const title = `${L.level} · Lektion ${L.n} — ${L.title}`;
  // Idempotencia por título
  const { rows: existing } = await pgc.query(
    `SELECT id FROM teacher_resources WHERE title = $1`, [title],
  );
  if (existing.length > 0) {
    console.log(`  · skip (ya existe): ${title}`);
    skipped++;
    continue;
  }

  const buf = fs.readFileSync(pdfPath);
  const key = `teacher-resources/${uploaderId}/seed-${Date.now()}-${L.level}-leccion-${L.n}-${L.slug}.pdf`;
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf, ContentType: "application/pdf",
  }));
  const fileUrl = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
  const fileName = path.basename(pdfPath);

  await pgc.query(`
    INSERT INTO teacher_resources
      (uploaded_by, title, description, level, topic, kind,
       file_url, file_name, file_size_bytes, storage_key, tags)
    VALUES ($1,$2,$3,$4,$5,'pdf',$6,$7,$8,$9,$10)`,
    [
      uploaderId,
      title,
      `Presentación oficial para clase en vivo. Tema: ${L.title}. Incluye objetivos, vocabulario, gramática, ejemplos y ejercicio guiado.`,
      L.level,
      "presentación oficial",
      fileUrl,
      fileName,
      buf.length,
      key,
      ["oficial", "presentación", L.level.toLowerCase(), L.slug],
    ],
  );
  uploaded++;
  console.log(`  ✓ ${title}  (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

// Cuadernos como recurso aparte (DOCX) — los profes pueden compartirlos
// a sus alumnos via el sistema 'materials' existente. Aquí los
// agregamos también a la biblioteca de profes.
for (const L of LECCIONES) {
  const wbPath = path.join(ROOT, L.level, `${L.level}-leccion-${L.n}-${L.slug}-cuaderno.docx`);
  if (!fs.existsSync(wbPath)) continue;

  const title = `${L.level} · Cuaderno Lektion ${L.n} — ${L.title}`;
  const { rows: existing } = await pgc.query(`SELECT id FROM teacher_resources WHERE title = $1`, [title]);
  if (existing.length > 0) { skipped++; continue; }

  const buf = fs.readFileSync(wbPath);
  const key = `teacher-resources/${uploaderId}/seed-${Date.now()}-${L.level}-leccion-${L.n}-${L.slug}-cuaderno.docx`;
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf,
    ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  const fileUrl = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
  await pgc.query(`
    INSERT INTO teacher_resources
      (uploaded_by, title, description, level, topic, kind,
       file_url, file_name, file_size_bytes, storage_key, tags)
    VALUES ($1,$2,$3,$4,$5,'doc',$6,$7,$8,$9,$10)`,
    [
      uploaderId,
      title,
      `Cuaderno del alumno para Lektion ${L.n} (${L.title}). Vocabulario, espacio para notas y 5 ejercicios.`,
      L.level,
      "cuaderno alumno",
      fileUrl,
      path.basename(wbPath),
      buf.length,
      key,
      ["oficial", "cuaderno", L.level.toLowerCase(), L.slug],
    ],
  );
  uploaded++;
  console.log(`  ✓ ${title}`);
}

console.log(`\n✔ Done: uploaded=${uploaded}, skipped=${skipped}`);
await pgc.end();
