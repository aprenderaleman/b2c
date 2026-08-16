import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { ConvertBody, convertLeadToStudent } from "@/lib/lead-conversion";
import { supabaseAdmin } from "@/lib/supabase";
import { cancelActiveChain } from "@/lib/chain-engine";
import { applyReferralReward } from "@/lib/referrals";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let rawBody: Record<string, unknown>;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const { packId, paymentType, ...convertFields } = rawBody;

  const parsed = ConvertBody.safeParse(convertFields);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  if (typeof packId === "string") {
    const { data: leadRow } = await sb
      .from("leads")
      .select("meta")
      .eq("id", leadId)
      .maybeSingle();
    const meta = ((leadRow?.meta as Record<string, unknown>) ?? {});
    await sb.from("leads").update({
      meta: {
        ...meta,
        last_offered_pack: packId,
        last_offered_payment: paymentType ?? "single",
      },
    }).eq("id", leadId);
  }

  try {
    const result = await convertLeadToStudent(leadId, parsed.data);

    await cancelActiveChain(leadId, "payment_confirmed").catch(() => {});

    // Recompensa de referido (si el lead vino con ?ref) — idempotente.
    await applyReferralReward(leadId).catch((e) =>
      console.warn("[confirm-payment] applyReferralReward failed:", e instanceof Error ? e.message : e));

    await registerContact({
      leadId,
      actor: await actorFromPanelUser(user),
      actionType: "confirmar_pago",
      channel: "otro",
      note: "Pago confirmado desde el panel",
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "lead_not_found") {
      return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
    }
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "email_already_in_use", message: "Ese correo ya pertenece a otro usuario." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_student_failed", message: msg }, { status: 500 });
  }
}
