import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getStudentByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "student" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole: role as "student" | "admin" | "superadmin",
    expectRole: "student",
  });
  const student = await getStudentByUserId(eff.userId);
  if (!student) return NextResponse.json({ error: "no_student_profile" }, { status: 404 });

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("students")
    .select("classes_remaining, classes_purchased, classes_adjustment")
    .eq("id", student.id)
    .single();

  return NextResponse.json({
    ok: true,
    classes_remaining: data?.classes_remaining ?? 0,
    classes_purchased: data?.classes_purchased ?? 0,
  });
}
