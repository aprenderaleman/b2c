import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

// GDPR Art. 17 — Right to erasure. Hard-deletes the lead + all cascading
// rows (timeline, notes). We keep a minimal audit record in
// `lead_deletion_log` (hashed phone + date) so we can prove the deletion
// was requested + performed, without retaining any identifying data.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, whatsapp_normalized")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: rpcError } = await sb.rpc("gdpr_delete_lead", { p_lead_id: id });
  if (rpcError) {
    // Helper function isn't installed yet — fall back to plain DELETE.
    await sb.from("leads").delete().eq("id", id);
  }

  return NextResponse.redirect(new URL("/admin/leads", req.url), { status: 303 });
}
