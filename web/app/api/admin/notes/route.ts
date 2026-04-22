import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createAdminNote } from "@/lib/admin-notes";

/**
 * POST /api/admin/notes
 *
 * Create a new admin note on a student or teacher. Caller must be
 * admin or superadmin. author_id is forced to the caller's user id
 * server-side (client cannot impersonate authorship).
 */
export const runtime = "nodejs";

const Body = z.object({
  target_type: z.enum(["student", "teacher"]),
  target_id:   z.string().uuid(),
  content:     z.string().trim().min(1).max(10000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const note = await createAdminNote(
      parsed.data.target_type,
      parsed.data.target_id,
      (session.user as { id: string }).id,
      parsed.data.content,
    );
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return NextResponse.json(
      { error: "create_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
