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
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const parsed = previewBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const recipients = await resolveRecipients(parsed.data.audience_filter);
  return NextResponse.json({
    ok:         true,
    total:      recipients.length,
    recipients,
  });
}
