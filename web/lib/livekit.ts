import { AccessToken } from "livekit-server-sdk";

/**
 * LiveKit connection settings. Reads from env so we can swap the self-hosted
 * server (Hetzner, Phase 3 infra) and a dev server without redeploying code.
 *
 * Env vars:
 *   LIVEKIT_URL         e.g. wss://livekit.aprender-aleman.de
 *   LIVEKIT_API_KEY     server API key
 *   LIVEKIT_API_SECRET  server API secret
 *
 * If any of them is missing we return ok=false so the UI can show a
 * "aula no disponible todavía" state instead of crashing. This lets
 * Phase 3 code deploy to Vercel BEFORE Gelfis finishes installing
 * LiveKit on the VPS.
 */
export function livekitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET,
  );
}

export function livekitUrl(): string {
  return process.env.LIVEKIT_URL ?? "";
}

export type LivekitRoleTokenInput = {
  identity:      string;       // unique per-user; we use users.id
  name:          string;       // display name shown in the room
  roomName:      string;       // matches classes.livekit_room_id
  isHost:        boolean;      // teacher = host, can publish + moderate
};

/**
 * Mint a JWT access token for a user to join a specific room. Hosts get
 * full video/audio/data publish rights plus `roomAdmin` (so they can
 * mute others or end the room). Participants can publish their own
 * stream but can't moderate.
 *
 * Token TTL = 2h. Way longer than a typical class (60 min) so a user
 * who rejoins halfway through is fine.
 */
export async function mintLivekitToken(input: LivekitRoleTokenInput): Promise<string> {
  const apiKey    = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: input.identity,
    name:     input.name,
    ttl:      2 * 60 * 60,   // seconds
  });

  at.addGrant({
    roomJoin:        true,
    room:            input.roomName,
    canPublish:      true,
    canSubscribe:    true,
    canPublishData:  true,
    canUpdateOwnMetadata: true,
    // Host privileges — muting others, removing participants, ending room
    roomAdmin: input.isHost,
  });

  return at.toJwt();
}
