import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSignature, saveAdminSignature, signTeacherAgreement } from "@/lib/teacher-agreement";

/**
 * POST /api/admin/teachers/[id]/agreement/sign
 * Body: { dataUrl?: string (PNG de la firma recién dibujada), rate_individual?: number }
 * Estampa la firma de la academia en el acuerdo del profe y lo guarda como
 * versión firmada. Si no viene dataUrl, usa la firma guardada del admin.
 * Al aprobar al profe, el email de bienvenida adjunta esta versión.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const adminUserId = (session.user as { id: string }).id;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { dataUrl?: string; rate_individual?: number };

  let png: Buffer | null = null;
  if (body.dataUrl) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
    if (!m) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    png = Buffer.from(m[1], "base64");
    if (png.length < 500) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    await saveAdminSignature(adminUserId, png);      // queda guardada para la próxima
  } else {
    png = await getAdminSignature(adminUserId);
    if (!png) return NextResponse.json({ error: "no_signature", message: "Dibuja tu firma primero." }, { status: 400 });
  }

  const rate = Number.isFinite(body.rate_individual) && (body.rate_individual as number) > 0 ? (body.rate_individual as number) : null;
  try {
    const { path } = await signTeacherAgreement({ teacherId: id, adminUserId, signaturePng: png, rateOverride: rate });
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return NextResponse.json({ error: "sign_failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
