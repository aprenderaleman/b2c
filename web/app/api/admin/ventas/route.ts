import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") ?? "pendiente";

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("ventas")
    .select("*, leads!inner(full_name, email, whatsapp_normalized, status), users!ventas_solicitado_por_fkey(full_name, role)")
    .eq("estado", estado)
    .order("created_at", { ascending: false });

  return NextResponse.json({ ventas: data ?? [] });
}
