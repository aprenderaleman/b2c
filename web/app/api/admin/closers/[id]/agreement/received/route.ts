import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/closers/[id]/agreement/received
 * El admin confirma que el closer devolvió el acuerdo firmado.
 * (Los profes lo marcan vía onboarding; los closers no tienen onboarding,
 * así que queda en users.closer_agreement_received_at.) 2026-11-27.
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
  const { error } = await supabaseAdmin().from("users")
    .update({ closer_agreement_received_at: new Date().toISOString() })
    .eq("id", id).eq("role", "closer");
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
