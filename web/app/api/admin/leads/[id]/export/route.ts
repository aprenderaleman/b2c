import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLeadById, getGelfisNotes, getTimeline } from "@/lib/dashboard";

// GDPR Art. 15 — Right of access / data portability.
// Returns a machine-readable JSON dump of everything we store about the lead.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [lead, timeline, notes] = await Promise.all([
    getLeadById(id),
    getTimeline(id),
    getGelfisNotes(id),
  ]);

  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const payload = {
    exported_at: new Date().toISOString(),
    controller: {
      name: "Aprender-Aleman.de",
      contact: process.env.ADMIN_EMAIL ?? "info@aprender-aleman.de",
    },
    lead,
    timeline,
    gelfis_notes: notes,
  };

  const filename = `lead-${id}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
