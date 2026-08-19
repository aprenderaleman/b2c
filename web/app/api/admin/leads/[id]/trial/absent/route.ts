import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markTrialAbsent } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Auth: sesión admin (uso normal desde /admin) o Bearer CRON_SECRET
  // (uso desde script/CLI para backfills puntuales).
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cronOk = Boolean(process.env.CRON_SECRET) && bearer === process.env.CRON_SECRET;

  let actorInfo: { id: string; email: string | null; role: string } | null = null;
  if (!cronOk) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const u = session.user as { id: string; email?: string | null; role?: string };
    actorInfo = { id: u.id, email: u.email ?? null, role: u.role ?? "admin" };
  }

  const { id } = await params;
  await markTrialAbsent(id);

  if (actorInfo) {
    await registerContact({
      leadId: id,
      actor: await actorFromPanelUser(actorInfo),
      actionType: "no_show",
      channel: "aula",
    });
    return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, leadId: id });
}
