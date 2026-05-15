import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { previewBodySchema } from "@/lib/comunicados/schema";
import { resolveRecipients } from "@/lib/comunicados/audience";

/**
 * POST /api/admin/comunicados/preview
 *
 * Resolves an audience filter into the concrete recipient list so the UI
 * can show exactly who will receive the message before the admin confirms.
 * No sending happens here.
 *
 * The whole handler is wrapped in try/catch so an unhandled throw (e.g. a
 * stale JWT cookie, a Supabase outage, a malformed audience filter) never
 * leaks the Next.js HTML 500 page back to the browser — the UI parses
 * JSON and a stray "<!DOCTYPE…" body produces a useless message.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = await requireAdminApi();
    if (!guard.ok) return guard.res;

    const parsed = previewBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const recipients = await resolveRecipients(parsed.data.audience_filter);
    return NextResponse.json({
      ok:         true,
      total:      recipients.length,
      recipients,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("[comunicados/preview] crash:", message, e);
    return NextResponse.json(
      { error: "preview_failed", message },
      { status: 500 },
    );
  }
}
