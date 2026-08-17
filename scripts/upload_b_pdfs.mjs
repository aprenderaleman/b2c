import { config } from "dotenv";
import fs from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

config();

const c = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.R2_BUCKET || "aprender-aleman-recordings";

const pairs = [
  { src: "materiales-marketing/B1.pdf", key: "marketing/v1/b1-konjunktiv-ii.pdf" },
  { src: "materiales-marketing/B2.pdf", key: "marketing/v1/b2-pasiva-conectores.pdf" },
];
for (const p of pairs) {
  const buf = fs.readFileSync(p.src);
  await c.send(new PutObjectCommand({
    Bucket, Key: p.key, Body: buf, ContentType: "application/pdf",
  }));
  console.log(`✔ ${p.key}  (${(buf.length/1024).toFixed(0)} KB)`);
}
