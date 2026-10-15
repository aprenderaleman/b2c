import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSignature, saveAdminSignature } from "@/lib/teacher-agreement";

/**
 * Firma del admin para los acuerdos (se guarda una vez, PNG en Storage).
 *   GET  /api/admin/signature          → image/png o 404
 *   POST /api/admin/signature {dataUrl} → guarda la firma dibujada en el modal
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminId(): Promise<string | null> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) return null;
  return (session.user as { id: string }).id;
}

export async function GET() {
  const id = await adminId();
  if (!id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const png = await getAdminSignature(id);
  if (!png) return NextResponse.json({ error: "no_signature" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const id = await adminId();
  if (!id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { dataUrl?: string };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl ?? "");
  if (!m) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  const png = Buffer.from(m[1], "base64");
  if (png.length < 500 || png.length > 2_000_000) return NextResponse.json({ error: "invalid_signature_size" }, { status: 400 });
  await saveAdminSignature(id, png);
  return NextResponse.json({ ok: true });
}
