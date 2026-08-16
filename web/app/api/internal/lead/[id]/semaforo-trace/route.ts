import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSemaforo } from "@/lib/semaforo";

/**
 * GET /api/internal/lead/:id/semaforo-trace — check C4 de la spec:
 * "cada transición de color debe poder explicarse con los registros".
 *
 * Devuelve el color actual + la regla que lo causó + las evidencias
 * (registros concretos) que la sustentan. Sin estados fantasma.
 *
 * Auth: sesión admin/superadmin, o X-Cron-Secret para debug headless.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  let authorized = !!cronSecret && headerSecret === cronSecret;

  if (!authorized) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    authorized = role === "admin" || role === "superadmin";
  }
  if (!authorized) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const result = await getSemaforo(id);
  if (!result) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  return NextResponse.json({
    lead_id: id,
    color: result.color,
    regla: result.regla,
    causa: result.causa,
    badge: result.badge,
    detalle: result.detalle,
    trigger_at: result.triggerAt,
    limbo: result.limbo,
    evidencias: result.evidencias,
    calculado_en: new Date().toISOString(),
    ventana_habil: "08:00-22:00 Europe/Berlin",
  });
}
