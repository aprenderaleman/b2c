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

  // Cancel any future scheduled trial classes BEFORE deleting the lead.
  // The FK on classes.lead_id is ON DELETE SET NULL, so without this
  // step the class would survive as a ghost row with lead_id=NULL — and
  // appear on /profesor as "Agendada · (sin nombre)". Cancelling first
  // keeps the class in DB for audit but flips it out of the active
  // listings.
  const { error: cancelErr, data: cancelled } = await sb
    .from("classes")
    .update({
      status:      "cancelled",
      notes_admin: "[auto] Lead deleted — class auto-cancelled to avoid orphan listings.",
      updated_at:  new Date().toISOString(),
    })
    .eq("lead_id", id)
    .in("status", ["scheduled", "live"])
    .select("id");
  if (cancelErr) {
    console.warn("[delete-lead] could not auto-cancel future classes:", cancelErr.message);
  } else if (cancelled && cancelled.length > 0) {
    console.info(`[delete-lead] auto-cancelled ${cancelled.length} class(es) for lead ${id}`);
  }

  // Use the GDPR helper if it exists. Falls back to a plain DELETE
  // if the RPC isn't installed (migration 002 hasn't run, etc.).
  // Surface DB errors instead of silently swallowing them — the
  // previous version would redirect "successfully" while the lead
  // remained in the table (e.g. when the helper bailed on null
  // whatsapp_normalized before migration 037 fixed it).
  const { error: rpcError } = await sb.rpc("gdpr_delete_lead", { p_lead_id: id });
  if (rpcError) {
    console.warn(`[delete-lead] RPC failed, falling back to plain DELETE: ${rpcError.message}`);
    const { error: deleteError } = await sb.from("leads").delete().eq("id", id);
    if (deleteError) {
      return NextResponse.json(
        { error: "delete_failed", message: deleteError.message },
        { status: 500 },
      );
    }
  }

  // Verify the row is actually gone — defends against an RPC that
  // returns NULL without performing the delete (the bug we just fixed).
  const { data: stillThere } = await sb
    .from("leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (stillThere) {
    return NextResponse.json(
      { error: "delete_did_not_persist", message: "El lead sigue en la base de datos tras llamar al RPC. Revisa la función gdpr_delete_lead." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL("/admin/leads", req.url), { status: 303 });
}
