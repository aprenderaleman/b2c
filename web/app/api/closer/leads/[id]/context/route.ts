import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = session.user.id;
  const { id: leadId } = await params;

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("closer_id, qualification_answers")
    .eq("id", leadId)
    .single();

  if (!lead || (lead as { closer_id: string | null }).closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [teacherNoteResult, lastContactResult] = await Promise.all([
    sb
      .from("lead_timeline")
      .select("content, created_at")
      .eq("lead_id", leadId)
      .eq("author", "teacher")
      .order("created_at", { ascending: false })
      .limit(1),
    sb
      .from("acciones_closer")
      .select("created_at")
      .eq("lead_id", leadId)
      .eq("closer_id", closerId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  return NextResponse.json({
    teacherNote: teacherNoteResult.data?.[0] ?? null,
    qualification: (lead as { qualification_answers: unknown }).qualification_answers ?? null,
    lastContact: lastContactResult.data?.[0]?.created_at ?? null,
  });
}
