import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recordOnboardingEvent } from "@/lib/onboarding";

/**
 * POST /api/admin/teachers/[id]/agreement/received
 * El admin confirma que el profe devolvió el Acuerdo de Colaboración firmado.
 * Marca el paso "acuerdo" de sus Primeros pasos.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await recordOnboardingEvent("teacher", id, "acuerdo");
  return NextResponse.json({ ok: true });
}
