import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markTrialAttendedNoLink } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  await markTrialAttendedNoLink(id);
  const u = session.user as { id: string; email?: string | null; role?: string };
  await registerContact({
    leadId: id,
    actor: await actorFromPanelUser({ id: u.id, email: u.email, role: u.role ?? "admin" }),
    actionType: "asistio",
    channel: "aula",
  });

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
