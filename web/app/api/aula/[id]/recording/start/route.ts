import { NextResponse } from "next/server";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "livekit-server-sdk";
import { auth } from "@/lib/auth";
import { authorizeAulaAccess } from "@/lib/aula";
import { livekitConfigured, livekitUrl } from "@/lib/livekit";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/aula/{id}/recording/start
 *
 * Kicks off a room-composite egress for this class, saving the MP4 to the
 * S3 bucket configured via RECORDINGS_S3_* env vars.
 *
 * Gated to the class's assigned teacher (or admin). Idempotent:
 * re-calling while an active egress already exists just returns that
 * egress id instead of starting a second one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req:   Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const userRole = (session.user as { role: "superadmin"|"admin"|"teacher"|"student" }).role;
  const decision = await authorizeAulaAccess(
    classId,
    (session.user as { id: string }).id,
    userRole,
  );
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  const isHost  = decision.ok && decision.role === "host";
  if (!decision.ok || (!isHost && !isAdmin)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  if (!livekitConfigured()) {
    return NextResponse.json({ error: "livekit_not_configured" }, { status: 503 });
  }

  // Check S3 config upfront so we fail clearly.
  const s3 = {
    endpoint:  process.env.RECORDINGS_S3_ENDPOINT,
    bucket:    process.env.RECORDINGS_S3_BUCKET,
    region:    process.env.RECORDINGS_S3_REGION ?? "us-east-1",
    accessKey: process.env.RECORDINGS_S3_ACCESS_KEY,
    secret:    process.env.RECORDINGS_S3_SECRET,
    forcePathStyle: process.env.RECORDINGS_S3_FORCE_PATH_STYLE !== "false",
  };
  for (const k of ["endpoint", "bucket", "accessKey", "secret"] as const) {
    if (!s3[k]) {
      return NextResponse.json(
        { error: "recording_storage_missing", missing: k },
        { status: 503 },
      );
    }
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes").select("livekit_room_id, status").eq("id", classId).maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const roomName = (cls as { livekit_room_id: string }).livekit_room_id;

  const httpsUrl = livekitUrl().replace(/^wss:/, "https:");
  const eg = new EgressClient(httpsUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);

  // Idempotency: if there's already an active egress for this room, return it.
  try {
    const active = await eg.listEgress({ roomName, active: true });
    if (active.length > 0) {
      return NextResponse.json({ ok: true, egress_id: active[0].egressId, reused: true });
    }
  } catch { /* listEgress is best-effort */ }

  const key = `classes/${classId}/${Date.now()}.mp4`;
  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: key,
    output: {
      case: "s3",
      value: new S3Upload({
        endpoint:       s3.endpoint!,
        bucket:         s3.bucket!,
        region:         s3.region,
        accessKey:      s3.accessKey!,
        secret:         s3.secret!,
        forcePathStyle: s3.forcePathStyle,
      }),
    },
  });

  try {
    const info = await eg.startRoomCompositeEgress(roomName, { file: fileOutput }, {
      layout: "speaker",
    });

    // Mirror into our recordings table with status=processing so the UI
    // instantly shows "grabando…". file_url arrives via the egress webhook
    // when LiveKit finishes the upload. We keep `key` only to log it.
    console.log(`egress started for class=${classId} → s3://${s3.bucket}/${key}`);
    await sb.from("recordings").insert({
      class_id:  classId,
      egress_id: info.egressId,
      status:    "processing",
    });

    return NextResponse.json({ ok: true, egress_id: info.egressId });
  } catch (e) {
    return NextResponse.json(
      { error: "egress_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
