import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { uploadToBucket } from "@/lib/storage";
import { ATTACHMENT_LIMITS, type Attachment } from "@/lib/comunicados/types";

/**
 * POST /api/admin/comunicados/upload
 *
 * Multipart upload for ONE file at a time. The UI calls this once per
 * file the admin picks; the response is an Attachment metadata object
 * that the UI accumulates into the form state. The actual bytes live
 * in the `materials` Supabase bucket under `comunicados/<adminId>/...`.
 *
 * We validate type + size HERE (server-trusted) — UI mirrors the same
 * limits but never trust client checks alone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allow request bodies up to ~30MB so a single 25MB attachment plus
// multipart overhead fits. Vercel serverless caps at 4.5MB by default
// for JSON; multipart is bigger but still bounded by route config.
export const maxDuration = 60;

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  // --- Validate ---
  const sizeOk = file.size > 0 && file.size <= ATTACHMENT_LIMITS.MAX_FILE_BYTES;
  if (!sizeOk) {
    return NextResponse.json(
      { error: "file_too_large", max_bytes: ATTACHMENT_LIMITS.MAX_FILE_BYTES, got: file.size },
      { status: 400 },
    );
  }

  const lower = (file.name ?? "").toLowerCase();
  const extOk = ATTACHMENT_LIMITS.ALLOWED_EXT.some(ext => lower.endsWith(ext));
  const mimeOk = ATTACHMENT_LIMITS.ALLOWED_MIME.includes(
    (file.type ?? "") as (typeof ATTACHMENT_LIMITS.ALLOWED_MIME)[number],
  );
  // Accept if EITHER ext or mime matches — Safari sometimes drops the
  // mime, and some servers send blank mime for .doc.
  if (!extOk && !mimeOk) {
    return NextResponse.json(
      { error: "file_type_not_allowed", allowed: ATTACHMENT_LIMITS.ALLOWED_EXT },
      { status: 400 },
    );
  }

  // --- Upload to bucket ---
  let uploaded;
  try {
    uploaded = await uploadToBucket(
      "materials",
      `comunicados/${guard.adminUserId}`,
      file,
      file.name || "attachment",
    );
  } catch (e) {
    return NextResponse.json(
      { error: "upload_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }

  const attachment: Attachment = {
    path:         uploaded.path,
    name:         uploaded.name,
    size:         uploaded.size || file.size,
    content_type: uploaded.content_type || file.type || "application/octet-stream",
  };

  return NextResponse.json({ ok: true, attachment });
}
