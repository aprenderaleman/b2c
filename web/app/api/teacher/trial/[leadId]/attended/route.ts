import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAttendedAwaitingConversion, type AttendedOptions } from "@/lib/admin-actions";
import { TRIAL_PACKS, type PackId, type PaymentType } from "@/lib/trial-packs";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

const VALID_PACKS = new Set<string>(TRIAL_PACKS.map(p => p.id));

function isPaymentType(s: unknown): s is PaymentType {
  return s === "single" || s === "flexible" || s === "extended";
}

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let opts: AttendedOptions | undefined;
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const packId      = typeof raw.packId      === "string" ? raw.packId      : "";
    const paymentType = typeof raw.paymentType === "string" ? raw.paymentType : "";
    const objective   = typeof raw.objective   === "string" ? raw.objective.trim() : "";
    const nivel       = typeof raw.nivel       === "string" ? raw.nivel.trim() : "";
    const fullUrl     = typeof raw.fullUrl     === "string" ? raw.fullUrl.trim() : "";
    const packLabel   = typeof raw.packLabel   === "string" ? raw.packLabel.trim() : "";
    if (VALID_PACKS.has(packId) && isPaymentType(paymentType)) {
      opts = {
        packId: packId as PackId, paymentType, objective,
        ...(nivel ? { nivel } : {}),
        ...(fullUrl ? { fullUrl } : {}),
        ...(packLabel ? { packLabel } : {}),
      };
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await markTrialAttendedAwaitingConversion(leadId, opts);
  await registerContact({
    leadId,
    actor: await actorFromPanelUser(user),
    actionType: opts ? "enviar_enlace" : "asistio",
    channel: opts ? "whatsapp" : "aula",
    note: opts?.packLabel ? `Oferta: ${opts.packLabel}` : null,
  });
  return NextResponse.json({ ok: true });
}
