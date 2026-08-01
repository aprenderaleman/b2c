import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;

  const sb = supabaseAdmin();

  const { data: userRow } = await sb
    .from("users")
    .select("id, email, full_name, role, active, rango")
    .eq("id", userId)
    .single();

  const { data: leadsAsCloser } = await sb
    .from("leads")
    .select("id, name, email, closer_id, estado_cierre, fecha_asignacion_closer")
    .eq("closer_id", userId);

  const { data: allCloserLeads } = await sb
    .from("leads")
    .select("id, name, closer_id, estado_cierre")
    .not("closer_id", "is", null);

  return NextResponse.json({
    session_user_id: userId,
    session_role: role,
    user_in_db: userRow,
    leads_for_this_closer: leadsAsCloser ?? [],
    all_leads_with_any_closer: (allCloserLeads ?? []).map((l: any) => ({
      lead_id: l.id,
      lead_name: l.name,
      closer_id: l.closer_id,
      estado_cierre: l.estado_cierre,
    })),
  });
}
