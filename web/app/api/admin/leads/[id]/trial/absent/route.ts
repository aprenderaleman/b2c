import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markTrialAbsent } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await markTrialAbsent(id);
  const u = session.user as { id: string; email?: string | null; role?: string };
  await registerContact({
    leadId: id,
    actor: await actorFromPanelUser({ id: u.id, email: u.email, role: u.role ?? "admin" }),
    actionType: "no_show",
    channel: "aula",
  });
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
