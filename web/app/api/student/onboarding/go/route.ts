import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recordOnboardingEventByUser } from "@/lib/onboarding";
import { TEACHER_ONBOARDING_DOC_URL } from "@/lib/teacher-onboarding";

/**
 * GET /api/student/onboarding/go?step=hans
 * Registra el paso y redirige al destino (enlaces externos que no pasan
 * por nuestro servidor, p. ej. HANS).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEST: Record<string, string> = {
  hans: "https://hans.aprender-aleman.de",
  guia: TEACHER_ONBOARDING_DOC_URL,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const step = url.searchParams.get("step") ?? "";
  const dest = DEST[step];
  if (!dest) return NextResponse.json({ error: "unknown_step" }, { status: 400 });
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (session?.user && (role === "student" || role === "teacher")) {
    await recordOnboardingEventByUser(role, (session.user as { id: string }).id, step).catch(() => {});
  }
  return NextResponse.redirect(dest);
}
