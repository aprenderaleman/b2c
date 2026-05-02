import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 signed-URL helper.
 *
 * Recording `file_url`s stored in the DB point directly at the R2
 * HTTPS endpoint. That bucket is PRIVATE — the browser can't play the
 * video without credentials. We sign a short-lived GET URL on demand
 * (6h default) so the <video> tag can stream it without exposing our
 * keys to the client.
 *
 * Env vars required on Vercel:
 *   R2_ACCOUNT_ID           the subdomain part before .r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID        access key
 *   R2_SECRET_ACCESS_KEY    secret
 *   R2_BUCKET               optional, defaults to "aprender-aleman-recordings"
 *   R2_PUBLIC_DOMAIN        optional. If set (e.g. "recordings.aprender-aleman.de"),
 *                           signed URLs are rewritten to use that host so playback
 *                           goes through Cloudflare CDN edge cache instead of
 *                           hitting the R2 origin every time. Massive speed-up
 *                           for big MP4s. Configure this domain in Cloudflare
 *                           dashboard → R2 bucket → "Custom Domains".
 */

const DEFAULT_BUCKET = "aprender-aleman-recordings";
const DEFAULT_EXPIRES_SECONDS = 6 * 3600;   // 6h — plenty to watch a class

let _client: S3Client | null = null;
function client(): S3Client | null {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  _client = new S3Client({
    region:   "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

/**
 * Extract the object key from a stored file_url.
 * Format emitted by LiveKit egress:
 *   https://<ACCOUNT>.r2.cloudflarestorage.com/<BUCKET>/<KEY>
 */
function keyFromFileUrl(fileUrl: string): { bucket: string; key: string } | null {
  const m = fileUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

/**
 * Produce a short-lived signed URL for playback. If R2 is not
 * configured in the current deployment (missing env vars), returns
 * the raw URL — caller should understand that will fail in a browser
 * but won't crash. In production, the keys should always be set.
 */
export async function signRecordingUrl(
  fileUrl: string,
  expiresIn: number = DEFAULT_EXPIRES_SECONDS,
): Promise<string> {
  const c = client();
  if (!c) {
    console.warn("[r2] not configured — returning raw file_url; playback will fail");
    return fileUrl;
  }
  const parts = keyFromFileUrl(fileUrl);
  if (!parts) return fileUrl;
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET || parts.bucket || DEFAULT_BUCKET,
    Key:    parts.key,
  });
  try {
    const signed = await getSignedUrl(c, cmd, { expiresIn });
    // Rewrite the host to a CDN-enabled custom domain when configured.
    // Cloudflare's R2 custom domains are CDN-fronted, so the same object
    // streams from the nearest edge instead of the bucket origin —
    // turns slow first-byte + linear download into a fast cached fetch.
    // The signature is path-based; rewriting just the host preserves
    // authentication AS LONG AS the custom domain is bound to the same
    // bucket in the Cloudflare dashboard.
    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (publicDomain) {
      try {
        const u = new URL(signed);
        u.host = publicDomain;
        // R2 custom domains use virtual-hosted-style; drop the bucket
        // path prefix that the SDK injected.
        const bucket = process.env.R2_BUCKET || parts.bucket || DEFAULT_BUCKET;
        if (u.pathname.startsWith(`/${bucket}/`)) {
          u.pathname = u.pathname.slice(bucket.length + 1);
        }
        return u.toString();
      } catch {
        // If anything in the rewrite fails, fall back to the raw signed URL.
      }
    }
    return signed;
  } catch (e) {
    console.error("[r2] sign failed:", e);
    return fileUrl;
  }
}

/**
 * Hard-delete the object from R2. Best-effort — returns true if the
 * delete succeeded OR if R2 isn't configured (dev fallback). Returns
 * false only when R2 is configured but the delete errored, so the
 * caller can decide whether to also drop the DB row.
 */
export async function deleteRecordingObject(fileUrl: string): Promise<boolean> {
  const c = client();
  if (!c) {
    console.warn("[r2] not configured — skipping object delete, treating as success");
    return true;
  }
  const parts = keyFromFileUrl(fileUrl);
  if (!parts) return true;                                // unparseable URL, nothing to delete
  const cmd = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET || parts.bucket || DEFAULT_BUCKET,
    Key:    parts.key,
  });
  try {
    await c.send(cmd);
    return true;
  } catch (e) {
    console.error("[r2] delete failed:", e);
    return false;
  }
}
