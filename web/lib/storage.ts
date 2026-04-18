import { supabaseAdmin } from "./supabase";

export type UploadedFile = {
  path:          string;       // storage key (e.g. "user-id/uuid.pdf")
  url:           string;       // resolved URL — signed or direct
  name:          string;
  size:          number;
  content_type:  string;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;   // 7 days

/**
 * Upload a file coming in via FormData to a Supabase Storage bucket. The
 * caller is responsible for deciding which bucket + what the file size/
 * MIME limits are — we enforce only what Supabase already enforces via
 * the bucket config.
 *
 * Returns the final path + a 7-day signed URL the frontend can embed.
 */
export async function uploadToBucket(
  bucket:   "chat-uploads" | "materials",
  pathPrefix: string,              // e.g. "userId" or "teacherId"
  file:     File | Blob,
  fileName: string,
): Promise<UploadedFile> {
  const sb = supabaseAdmin();

  // Extension from the original filename.
  const clean = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path  = `${pathPrefix}/${crypto.randomUUID()}-${clean}`;

  const { error: upErr } = await sb.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert:       false,
    contentType:  (file as File).type || "application/octet-stream",
  });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);

  const { data: signed, error: sgErr } = await sb
    .storage.from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (sgErr || !signed) throw new Error(`sign url failed: ${sgErr?.message ?? "unknown"}`);

  return {
    path,
    url:  signed.signedUrl,
    name: clean,
    size: (file as File).size ?? 0,
    content_type: (file as File).type || "application/octet-stream",
  };
}

/**
 * Refresh a signed URL for an existing object — used when a stored URL has
 * expired and we want to re-sign on demand.
 */
export async function refreshSignedUrl(
  bucket: "chat-uploads" | "materials",
  path: string,
): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
