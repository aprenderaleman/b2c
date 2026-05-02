import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/students/credits-min
 * Body: { student_ids: uuid[] }
 *
 * Returns the minimum `classes_remaining` across the given students, plus
 * a per-student breakdown. Used by the Create-group wizard to auto-fill
 * `totalSessions` when the admin checks "until-credits-run-out".
 *
 * Admin-only.
 */
export const runtime = "nodejs";

const Body = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(50),
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
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("students")
    .select("id, classes_remaining, users!inner(full_name, email)")
    .in("id", parsed.data.student_ids);
  if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });

  type Row = { id: string; classes_remaining: number; users: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] };
  const rows = (data ?? []) as Row[];
  const flat = rows.map(r => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      id: r.id,
      remaining: r.classes_remaining ?? 0,
      name: u?.full_name ?? u?.email ?? "—",
    };
  });
  const min = flat.length === 0 ? 0 : Math.min(...flat.map(r => r.remaining));
  return NextResponse.json({ ok: true, min, students: flat });
}
