import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSystemPauseStatus, pauseSystem, resumeSystem } from "@/lib/system-pause";

/**
 * Pausa/reanuda manual del envio masivo (crons + agents/python).
 *
 *   GET    → estado actual
 *   POST   ?hours=5&reason=ban-5h → pausa N horas
 *   DELETE → reanuda inmediatamente
 *
 * Solo superadmin. Todos los crons consultan `config.system_paused_until`
 * en cada run y saltan si ahora < ese timestamp.
 *
 * Caso 2026-06-12: tras un ban de 5h de WhatsApp, ejecutar
 *   POST /api/admin/system/pause?hours=6&reason=wa-ban-5h
 * y reanudar manualmente cuando confirmes que Evolution esta open.
 */

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  const status = await getSystemPauseStatus();
  return NextResponse.json(status);
}

export async function POST(req: Request) {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const hoursRaw = Number(url.searchParams.get("hours") ?? "6");
  const reason   = (url.searchParams.get("reason") ?? "manual").slice(0, 200);
  const hours    = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 168 ? hoursRaw : 6;
  await pauseSystem(hours, reason);
  return NextResponse.json({ ok: true, paused_for_hours: hours, reason });
}

export async function DELETE() {
  const denied = await requireSuperadmin();
  if (denied) return denied;
  await resumeSystem();
  return NextResponse.json({ ok: true, resumed: true });
}
