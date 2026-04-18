import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { authorizeAulaAccess } from "@/lib/aula";

/**
 * POST /api/aula/[id]/start
 *
 * Called by the teacher client when their LiveKit connection finishes
 * establishing. Sets classes.status='live' and started_at=now() (if the
 * class isn't already live or completed). Idempotent.
 *
 * Only the host teacher can mark a class as started.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const access = await authorizeAulaAccess(id, userId, role);
  if (!access.ok || access.role !== "host") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("classes")
    .update({
      status:     "live",
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["scheduled"]);   // only promote 'scheduled' → 'live'
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
