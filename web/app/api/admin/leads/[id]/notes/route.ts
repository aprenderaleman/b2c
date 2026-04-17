import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addGelfisNote } from "@/lib/admin-actions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const form = await req.formData();
  const note = String(form.get("note") ?? "");
  await addGelfisNote(id, note);
  return NextResponse.redirect(new URL(`/admin/leads/${id}`, req.url), { status: 303 });
}
