#!/usr/bin/env node
/**
 * Verify that our R2 credentials + bucket name round-trip correctly:
 *   1. putObject  — upload a 128-byte test file
 *   2. headObject — confirm it exists
 *   3. getObject  — read it back
 *   4. deleteObject
 *
 * If any step fails, LiveKit egress would also fail — better to catch it
 * here than in prod during a real class.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand }
  = require("@aws-sdk/client-s3");

const ENDPOINT   = "https://449485307c9f31abd960bae5966d3fb8.r2.cloudflarestorage.com";
const BUCKET     = "aprender-aleman-recordings";
const ACCESS_KEY = "dc5006a198eb5b0cd12f8f55b2fa5725";
const SECRET     = "3188bad5688d33ba3c363bb726919939a04ebc516baf2294e34b8d944c20a54f";

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET },
  forcePathStyle: true,
});

const key = `smoke-test/${Date.now()}.txt`;
const body = Buffer.from(`hola desde aprender-aleman · ${new Date().toISOString()}\n`);

console.log(`→ putObject(${key}, ${body.length} bytes)`);
await s3.send(new PutObjectCommand({
  Bucket: BUCKET,
  Key: key,
  Body: body,
  ContentType: "text/plain; charset=utf-8",
}));
console.log("  ✓ upload OK");

console.log(`→ headObject(${key})`);
const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
console.log(`  ✓ exists · size=${head.ContentLength} · etag=${head.ETag}`);

console.log(`→ getObject(${key})`);
const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
const chunks = [];
for await (const c of got.Body) chunks.push(c);
const roundtrip = Buffer.concat(chunks).toString("utf8");
console.log(`  ✓ downloaded: ${JSON.stringify(roundtrip.slice(0, 60))}…`);

console.log(`→ deleteObject(${key})`);
await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
console.log("  ✓ deleted");

console.log("\n🎉 R2 credentials + bucket funcionan al 100%.");
