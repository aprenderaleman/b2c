#!/usr/bin/env node
/**
 * Smoke-test critical HTTP endpoints in production without a session
 * cookie. Expected behavior:
 *   - Admin endpoints → 401 unauthorized
 *   - Aula token → 401 unauthorized
 *   - Moderation → 401
 *   - Health/non-gated public pages → 200
 * If any admin-gated endpoint returns 200 without auth → critical leak.
 */

const BASE = process.env.BASE_URL ?? "https://aprender-aleman.de";

const tests = [
  // (method, path, expected_statuses[], description)
  ["GET",  "/",                                  [200, 301, 302],        "home page public"],
  ["GET",  "/login",                             [200, 307, 308],        "login page public"],
  ["GET",  "/admin",                             [200, 302, 307, 401],   "admin root (should redirect or gate)"],
  ["GET",  "/api/admin/health",                  [401],                   "admin health (no session → 401)"],
  ["GET",  "/api/admin/finanzas/profesores/fake-id/invoice/2026-04", [401, 404], "invoice PDF (no auth)"],
  ["POST", "/api/aula/00000000-0000-0000-0000-000000000000/token",   [401],    "aula token (no session → 401)"],
  ["POST", "/api/aula/00000000-0000-0000-0000-000000000000/moderate",[401],    "moderate (no session → 401)"],
  ["GET",  "/api/admin/classes",                 [401, 405],              "admin classes (no auth)"],
  ["GET",  "/api/admin/teachers",                [401, 405],              "admin teachers (no auth)"],
  ["GET",  "/api/admin/users",                   [401, 405],              "admin users (no auth)"],
  ["GET",  "/api/admin/picker",                  [401, 405],              "admin picker (no auth)"],
  ["POST", "/api/admin/finanzas/payments",       [401],                   "finanzas payments (no auth)"],
  ["GET",  "/estudiante",                        [302, 307, 401],         "student area (no auth)"],
  ["GET",  "/profesor",                          [302, 307, 401],         "teacher area (no auth)"],
  ["GET",  "/aula/nonexistent",                  [302, 307, 401, 404],    "aula (no auth)"],
];

let ok = 0, fail = 0;

for (const [method, path, expected, label] of tests) {
  const url = BASE + path;
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body:    method === "POST" ? "{}" : undefined,
    });
    const pass = expected.includes(res.status);
    const status = pass ? "OK  " : "FAIL";
    if (pass) ok++; else fail++;
    console.log(`[${status}] ${method.padEnd(4)} ${path.padEnd(60)} → ${res.status}  (expected ${expected.join(",")})`);
    if (!pass) {
      // Read small body for context
      const t = await res.text();
      console.log(`        body: ${t.slice(0, 200).replace(/\s+/g, " ")}`);
    }
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${method.padEnd(4)} ${path.padEnd(60)} → network error: ${e.message}`);
  }
}

console.log(`\n═══ RESUMEN ═══`);
console.log(`  OK:   ${ok}`);
console.log(`  FAIL: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
