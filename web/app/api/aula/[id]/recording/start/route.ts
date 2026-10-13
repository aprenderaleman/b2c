import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { EgressClient, EncodedFileOutput, EncodedFileType, EncodingOptionsPreset, S3Upload } from "livekit-server-sdk";
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

// % de clases regulares que se graban de verdad (trials: siempre 100%).
const RECORDING_SAMPLE_PCT = 50;

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
    .from("classes").select("livekit_room_id, status, is_trial").eq("id", classId).maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const roomName = (cls as { livekit_room_id: string }).livekit_room_id;
  const isTrial  = (cls as { is_trial: boolean | null }).is_trial === true;

  // Muestreo de grabación (Gelfis 2026-10-13, reducción de coste LiveKit):
  // las clases regulares solo se graban de verdad el 50% de las veces.
  // Sorteo DETERMINISTA por id de clase (hash md5 % 100), así un refresh
  // o una reconexión del profe cae siempre en el mismo lado. Los trials
  // se graban SIEMPRE (evidencia de asistencia). La respuesta simulada
  // es indistinguible para el cliente: el aula muestra el pill REC igual.
  // Un admin que llame al endpoint sin ser el host graba de verdad.
  if (!isTrial && isHost && !isAdmin) {
    const bucket = parseInt(createHash("md5").update(classId).digest("hex").slice(0, 8), 16) % 100;
    if (bucket >= RECORDING_SAMPLE_PCT) {
      return NextResponse.json({ ok: true, egress_id: `sim-${classId.slice(0, 8)}` });
    }
  }

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
      // 720p30 en vez del preset 1080p por defecto (Gelfis 2026-10-12):
      // ~30-40% menos coste de egress en LiveKit y ~la mitad de GB en
      // R2, sin pérdida apreciable en clases habladas.
      encodingOptions: EncodingOptionsPreset.H264_720P_30,
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
