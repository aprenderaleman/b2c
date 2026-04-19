import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/picker
 *
 * Two modes:
 *   - (default)   returns teachers + students arrays used by the "Create
 *                 class" modal's dropdowns.
 *   - ?q=<str>    additionally returns a flat `users` array ({ id,
 *                 full_name, email, role }) filtered by name/email —
 *                 used by the impersonation picker. `id` is users.id
 *                 (NOT teachers.id / students.id), required by
 *                 /api/admin/impersonate/start.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const sb = supabaseAdmin();

  // For the search variant, query users table directly.
  if (q.length >= 2) {
    const { data } = await sb
      .from("users")
      .select("id, full_name, email, role, active")
      .eq("active", true)
      .in("role", ["teacher", "student"])
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .order("full_name", { ascending: true })
      .limit(20);
    const users = (data ?? []).map(u => ({
      id:        (u as { id: string }).id,
      full_name: (u as { full_name: string | null }).full_name,
      email:     (u as { email: string }).email,
      role:      (u as { role: "teacher" | "student" }).role,
    }));
    return NextResponse.json({ users });
  }

  const [teachersRes, studentsRes] = await Promise.all([
    sb.from("teachers")
      .select(`id, active, users!inner(email, full_name)`)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    sb.from("students")
      .select(`id, current_level, subscription_status, users!inner(email, full_name)`)
      .in("subscription_status", ["active", "paused"])
      .order("converted_at", { ascending: false }),
  ]);

  if (teachersRes.error) {
    return NextResponse.json({ error: teachersRes.error.message }, { status: 500 });
  }
  if (studentsRes.error) {
    return NextResponse.json({ error: studentsRes.error.message }, { status: 500 });
  }

  const flatten = (u: unknown) => {
    const uu = Array.isArray(u) ? u[0] : u;
    return uu as { email: string; full_name: string | null } | undefined;
  };

  const teachers = (teachersRes.data ?? []).map(t => {
    const u = flatten((t as { users: unknown }).users);
    return {
      id:        t.id as string,
      email:     u?.email ?? "",
      full_name: u?.full_name ?? null,
    };
  });

  const students = (studentsRes.data ?? []).map(s => {
    const u = flatten((s as { users: unknown }).users);
    return {
      id:                  s.id as string,
      email:               u?.email ?? "",
      full_name:           u?.full_name ?? null,
      current_level:       (s as { current_level: string }).current_level,
      subscription_status: (s as { subscription_status: string }).subscription_status,
    };
  });

  return NextResponse.json({ teachers, students });
}
