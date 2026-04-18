import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/picker
 *
 * Returns the minimal teacher + student lists needed to populate the
 * "Create class" modal's dropdowns. We keep it as a single endpoint so
 * the modal only makes one round-trip.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();

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
