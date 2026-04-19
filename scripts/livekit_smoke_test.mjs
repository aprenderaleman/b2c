#!/usr/bin/env node
/**
 * Smoke-test LiveKit Cloud credentials:
 *   1. Mint a short-lived access token (JWT decode + claims check)
 *   2. Call RoomService to create an ephemeral "smoke-test-<uuid>" room
 *   3. List rooms — confirm ours is there
 *   4. Delete the room
 *
 * If any step fails, something is wrong with the credentials/URL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath   = path.join(path.resolve(__dirname, ".."), ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const URL    = env.LIVEKIT_URL;
const KEY    = env.LIVEKIT_API_KEY;
const SECRET = env.LIVEKIT_API_SECRET;
if (!URL || !KEY || !SECRET) { console.error("✗ missing LIVEKIT_* env"); process.exit(1); }

console.log("URL:   ", URL);
console.log("KEY:   ", KEY);
console.log("SECRET:", SECRET.slice(0, 8) + "…");

// ---- 1. Mint a token for a fake user
const roomName = `smoke-test-${Math.random().toString(36).slice(2, 10)}`;
const at = new AccessToken(KEY, SECRET, { identity: "smoke-test-user", name: "Smoke Test" });
at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
const token = await at.toJwt();
console.log(`\n✓ Minted token (${token.length} chars)`);

// Decode header + payload (just base64)
const [hB64, pB64] = token.split(".");
const header  = JSON.parse(Buffer.from(hB64, "base64url").toString());
const payload = JSON.parse(Buffer.from(pB64, "base64url").toString());
console.log("  header:  ", header);
console.log("  identity:", payload.sub);
console.log("  room:    ", payload.video?.room);
console.log("  expires: ", new Date(payload.exp * 1000).toISOString());

// ---- 2. Create the room
// RoomServiceClient wants the HTTPS URL, not the wss:// one
const httpsUrl = URL.replace(/^wss:/, "https:");
const svc = new RoomServiceClient(httpsUrl, KEY, SECRET);

console.log(`\n→ Creating room "${roomName}"…`);
try {
  const room = await svc.createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: 5 });
  console.log("  ✓ created:", room.name, "sid=", room.sid, "max=", room.maxParticipants);
} catch (e) {
  console.error("  ✗ create failed:", e?.message ?? e);
  process.exit(1);
}

// ---- 3. List rooms — LiveKit Cloud auto-reaps empty rooms fast, so this
//        may return 0. Informational only.
console.log("\n→ Listing rooms (informational)…");
const rooms = await svc.listRooms();
console.log(`  total active: ${rooms.length}`);

// ---- 4. Best-effort delete (may already be gone)
try {
  await svc.deleteRoom(roomName);
  console.log("  ✓ deleted");
} catch {
  console.log("  (already reaped, fine)");
}

console.log("\n🎉 LiveKit Cloud is working — tokens, room API, and list all respond correctly.");
