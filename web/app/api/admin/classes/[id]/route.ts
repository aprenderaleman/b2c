import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cancelClass } from "@/lib/classes";

/**
 * DELETE /api/admin/classes/[id]?whole=1
 *
 * Cancels a class (status → 'cancelled'). If `whole=1` and the class is
 * part of a recurring series, every still-scheduled instance in the
 * series is cancelled.
 */

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const whole = url.searchParams.get("whole") === "1";

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  try {
    const r = await cancelClass(id, { whole });
    return NextResponse.json({ ok: true, cancelledIds: r.cancelledIds });
  } catch (e) {
    return NextResponse.json(
      { error: "cancel_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
