import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /trial-recover?class={uuid}&from=aula|grabacion
 *
 * Recuperador de acceso para leads de clase de prueba (caso Andreina
 * 2026-08-06): el profesor compartió la URL pelada /aula/{id} copiada
 * del navegador; el lead sin cuenta rebotaba a /login ("me pide un
 * correo electrónico") minutos antes de su clase.
 *
 * El middleware manda aquí los hits SIN sesión a /aula/{id} y
 * /grabacion/{id}. Si la clase es una trial, redirigimos a su link
 * corto /c/{short_code}, que setea la cookie de sesión de trial y
 * mete al lead al aula. Seguridad equivalente: quien conoce el UUID
 * de la clase no tiene menos acceso que quien conoce el shortcode.
 *
 * Si la clase no es trial (o no existe), login normal.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const classId = req.nextUrl.searchParams.get("class") ?? "";
  const from = req.nextUrl.searchParams.get("from") === "grabacion" ? "grabacion" : "aula";
  const base = req.nextUrl.origin;

  if (!/^[0-9a-f-]{36}$/i.test(classId)) {
    return NextResponse.redirect(`${base}/login`, 302);
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select("id, is_trial, short_code")
    .eq("id", classId)
    .maybeSingle();

  const cls = data as { id: string; is_trial: boolean; short_code: string | null } | null;

  if (cls?.is_trial && cls.short_code) {
    // /c/{code} setea la cookie y redirige al aula con ?t= de respaldo.
    return NextResponse.redirect(`${base}/c/${cls.short_code}`, 302);
  }

  // Clase regular (estudiante/profe con cuenta) → login con retorno.
  return NextResponse.redirect(
    `${base}/login?next=${encodeURIComponent(`/${from}/${classId}`)}`,
    302,
  );
}
