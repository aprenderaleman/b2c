import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getImpersonation } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { createSchuleSsoLink } from "@/lib/entitlements";
import {
  SCHULE_MAINTENANCE,
  SCHULE_MAINTENANCE_TITLE_ES,
  SCHULE_MAINTENANCE_BODY_ES,
} from "@/lib/schule-maintenance";

/**
 * GET /api/entitlements/schule-open
 *
 * User-facing endpoint that the "Entrar a Schule" button links to with
 * target="_blank". We do the SSO link request server-side and 302 the
 * browser straight to Schule's /auto-login. This avoids the popup-
 * blocker dance of window.open("about:blank") → fetch → set location,
 * which broke with noopener=true in recent Chrome versions.
 *
 * Error states render a tiny HTML message (for the new tab) instead of
 * JSON, so the student sees something useful if they navigate back.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlError(status: number, message: string) {
  const body = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Error · Aprender-Aleman.de</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:2rem;text-align:center;color:#334155}
h1{color:#dc2626;font-size:1.25rem;margin:0 0 .75rem}
p{color:#64748b;line-height:1.5}
a{display:inline-block;margin-top:1.5rem;color:#ea580c;text-decoration:none;font-weight:600}
</style></head><body>
<h1>No se pudo abrir Schule</h1>
<p>${message.replace(/[<>&"]/g, "")}</p>
<a href="https://b2c.aprender-aleman.de/estudiante">← Volver</a>
</body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET() {
  // Cortocircuito si SCHULE está en mantenimiento. Si alguien tiene
  // este enlace en una pestaña abierta o lo abre desde un email,
  // ve un mensaje legible en lugar de redirigirse a una app rota.
  if (SCHULE_MAINTENANCE) {
    const body = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${SCHULE_MAINTENANCE_TITLE_ES}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:32rem;margin:5rem auto;padding:2rem;text-align:center;color:#334155;line-height:1.6}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{color:#0f172a;font-size:1.5rem;margin:0 0 .75rem}
  p{color:#64748b}
  a{display:inline-block;margin-top:2rem;color:#fff;background:#ea580c;border-radius:.5rem;padding:.6rem 1.25rem;text-decoration:none;font-weight:600}
</style></head><body>
<div class="icon">🛠️</div>
<h1>${SCHULE_MAINTENANCE_TITLE_ES}</h1>
<p>${SCHULE_MAINTENANCE_BODY_ES}</p>
<a href="https://b2c.aprender-aleman.de/estudiante">← Volver al panel</a>
</body></html>`;
    return new NextResponse(body, {
      status:  503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect("https://b2c.aprender-aleman.de/login");
  }

  const imp = await getImpersonation();
  const userId = imp?.target_id ?? (session.user as { id: string }).id;

  const sb = supabaseAdmin();
  const { data: u } = await sb
    .from("users")
    .select("email, full_name, phone, role")
    .eq("id", userId)
    .maybeSingle();
  if (!u) return htmlError(404, "No encontramos tu usuario.");

  const role = (u as { role: string }).role;

  if (role === "student") {
    const { data: s } = await sb
      .from("students")
      .select("subscription_status, pack_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!s) return htmlError(403, "Tu cuenta no tiene perfil de estudiante.");
    const status = (s as { subscription_status: string }).subscription_status;
    const exp    = (s as { pack_expires_at: string | null }).pack_expires_at;
    const expired = exp ? new Date(exp) < new Date() : false;
    const eligible = (status === "active" || status === "paused") && !expired;
    if (!eligible) {
      return htmlError(403, "Tu pack no está activo. Contacta con el equipo.");
    }
  }

  const link = await createSchuleSsoLink({
    email:    (u as { email: string }).email,
    fullName: (u as { full_name: string | null }).full_name,
    phone:    (u as { phone: string | null }).phone,
  });

  if (!link.ok) {
    return htmlError(link.status, link.error);
  }

  return NextResponse.redirect(link.redirectUrl, 302);
}
