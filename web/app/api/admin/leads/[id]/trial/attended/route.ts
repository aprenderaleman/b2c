import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markTrialAttendedAwaitingConversion, type AttendedOptions } from "@/lib/admin-actions";
import { TRIAL_PACKS, type PackId, type PaymentType } from "@/lib/trial-packs";

const VALID_PACKS = new Set<string>(TRIAL_PACKS.map(p => p.id));

function isPaymentType(s: unknown): s is PaymentType {
  return s === "single" || s === "flexible" || s === "extended";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Accept either JSON (new modal flow) or x-www-form-urlencoded (legacy fallback).
  let opts: AttendedOptions | undefined = undefined;
  const ct = req.headers.get("content-type") || "";
  try {
    let raw: Record<string, unknown> = {};
    if (ct.includes("application/json")) {
      raw = (await req.json()) as Record<string, unknown>;
    } else if (ct.includes("form")) {
      const form = await req.formData();
      raw = Object.fromEntries(form.entries());
    }
    const packId      = typeof raw.packId      === "string" ? raw.packId      : "";
    const paymentType = typeof raw.paymentType === "string" ? raw.paymentType : "";
    const objective   = typeof raw.objective   === "string" ? raw.objective.trim() : "";
    const nivel       = typeof raw.nivel       === "string" ? raw.nivel.trim() : "";
    const fullUrl     = typeof raw.fullUrl     === "string" ? raw.fullUrl.trim() : "";
    const packLabel   = typeof raw.packLabel   === "string" ? raw.packLabel.trim() : "";
    if (VALID_PACKS.has(packId) && isPaymentType(paymentType) && objective.length > 0) {
      opts = {
        packId: packId as PackId, paymentType, objective,
        ...(nivel ? { nivel } : {}),
        ...(fullUrl ? { fullUrl } : {}),
        ...(packLabel ? { packLabel } : {}),
      };
    }
  } catch {
    // body parse failure → fallback to legacy generic message
  }

  await markTrialAttendedAwaitingConversion(id, opts);

  // If client sent JSON we return JSON; if a classic form submitted, redirect.
  if (ct.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
