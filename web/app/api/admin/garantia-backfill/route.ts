import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { issueGarantiaCertificate } from "@/lib/garantia-cert";
import { sendRaw } from "@/lib/email/send";

/**
 * POST /api/admin/garantia-backfill
 *
 * Emisión retroactiva de la Garantía de Nivel para estudiantes del
 * Método Nativo ya convertidos (los que compraron con la garantía
 * prometida). NO aplica a los legacy (compraron otro producto).
 *
 * Selección: students con oferta_id NOT NULL (señal fuerte de Método
 * Nativo — los legacy no tienen oferta). Se pueden añadir estudiantes
 * concretos vía body.extra_student_ids (casos borde: compras en la
 * web principal sin oferta interna).
 *
 * Body:
 *   {
 *     dry_run?: boolean,
 *     send_email?: boolean,
 *     extra?: Array<{ student_id: string, meta?: string, ritmo?: string,
 *                     tipo_pago?: string, clases_totales?: number }>
 *   }
 *
 * dry_run=true → solo lista candidatos, no emite ni envía nada.
 *
 * Auth: admin/superadmin o Bearer CRON_SECRET.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const maxDuration = 300;

async function authorised(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (secret && bearer === `Bearer ${secret}`) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

export async function POST(req: Request) {
  if (!(await authorised(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  type ExtraEntry = { student_id: string; meta?: string; ritmo?: string; tipo_pago?: string; clases_totales?: number; converted_at?: string };
  let body: { dry_run?: boolean; extra?: ExtraEntry[]; send_email?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const dryRun = body.dry_run ?? true;
  const sendEmail = body.send_email ?? true;

  const sb = supabaseAdmin();

  // Candidatos: Método Nativo = oferta_id presente.
  const { data: students } = await sb
    .from("students")
    .select(`
      id, oferta_id, conversion_source, created_at,
      users!inner(id, full_name, email),
      ofertas_enviadas(meta, ritmo, tipo_pago, clases_totales, accepted_at)
    `)
    .not("oferta_id", "is", null);

  type Row = {
    id: string; oferta_id: string; conversion_source: string | null; created_at: string;
    users: { id: string; full_name: string | null; email: string } | Array<{ id: string; full_name: string | null; email: string }>;
    ofertas_enviadas: { meta: string; ritmo: string | null; tipo_pago: string; clases_totales: number; accepted_at: string | null } |
      Array<{ meta: string; ritmo: string | null; tipo_pago: string; clases_totales: number; accepted_at: string | null }> | null;
  };

  const candidates = ((students ?? []) as Row[]).map(s => {
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    const o = Array.isArray(s.ofertas_enviadas) ? s.ofertas_enviadas[0] : s.ofertas_enviadas;
    return {
      studentId: s.id,
      name:      u?.full_name ?? u?.email ?? "Estudiante",
      email:     u?.email ?? null,
      meta:      o?.meta ?? null,
      ritmo:     o?.ritmo ?? null,
      tipoPago:  o?.tipo_pago ?? null,
      clases:    o?.clases_totales ?? null,
      converted: o?.accepted_at ?? s.created_at,
    };
  });

  // Extra students (casos borde señalados a mano, con overrides de
  // meta/ritmo porque su fila de students no lleva esos datos)
  for (const extra of body.extra ?? []) {
    if (candidates.some(c => c.studentId === extra.student_id)) continue;
    const { data: s } = await sb
      .from("students")
      .select("id, created_at, goal, subscription_type, classes_remaining, users!inner(full_name, email)")
      .eq("id", extra.student_id)
      .maybeSingle();
    if (!s) continue;
    const row = s as {
      id: string; created_at: string; goal: string | null;
      subscription_type: string | null; classes_remaining: number | null;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    };
    const u = Array.isArray(row.users) ? row.users[0] : row.users;
    candidates.push({
      studentId: row.id,
      name:      u?.full_name ?? u?.email ?? "Estudiante",
      email:     u?.email ?? null,
      meta:      extra.meta ?? row.goal,
      ritmo:     extra.ritmo ?? null,
      tipoPago:  extra.tipo_pago ?? (row.subscription_type === "monthly_subscription" ? "suscripcion" : "unico"),
      clases:    extra.clases_totales ?? row.classes_remaining,
      converted: extra.converted_at ?? row.created_at,
    });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dry_run: true, count: candidates.length, candidates });
  }

  const results: Array<{ studentId: string; name: string; numero?: string; emailed?: boolean; skipped?: string; error?: string }> = [];

  for (const c of candidates) {
    try {
      const issued = await issueGarantiaCertificate({
        studentId:      c.studentId,
        nombreCompleto: c.name,
        source: {
          meta:            c.meta,
          ritmo:           c.ritmo,
          tipoPago:        c.tipoPago,
          clasesTotales:   c.clases,
          fechaConversion: new Date(c.converted),
        },
      });
      if (!issued) {
        results.push({ studentId: c.studentId, name: c.name, error: "issue_failed" });
        continue;
      }
      if (issued.alreadyExisted) {
        results.push({ studentId: c.studentId, name: c.name, numero: issued.numero, skipped: "already_issued" });
        continue;
      }

      let emailed = false;
      if (sendEmail && c.email) {
        const firstName = c.name.split(/\s+/)[0] || c.name;
        const res = await sendRaw(
          c.email,
          "Tu Garantía de Nivel por escrito 📜",
          `<p>¡Hola ${firstName}!</p>` +
          `<p>Como parte de tu programa en Aprender-Aleman.de, te adjuntamos tu <strong>Garantía de Nivel por Escrito</strong> — nuestro compromiso formal contigo: si al completar tu programa no alcanzas tu nivel objetivo, continuamos tus clases completamente gratis hasta que lo consigas.</p>` +
          `<p>Guárdalo — también lo tienes siempre disponible en tu panel de estudiante, en la sección Certificados.</p>` +
          `<p>El equipo de Aprender-Aleman.de</p>`,
          `Hola ${firstName}!\n\nTe adjuntamos tu Garantía de Nivel por Escrito — nuestro compromiso formal: si al completar tu programa no alcanzas tu nivel objetivo, continuamos tus clases gratis hasta que lo consigas.\n\nTambién está en tu panel, sección Certificados.\n\nEl equipo de Aprender-Aleman.de`,
          [{ filename: `Garantia-de-Nivel-${issued.numero}.pdf`, content: issued.pdfBuffer, contentType: "application/pdf" }],
        );
        emailed = res.ok;
      }

      results.push({ studentId: c.studentId, name: c.name, numero: issued.numero, emailed });
    } catch (e) {
      results.push({ studentId: c.studentId, name: c.name, error: e instanceof Error ? e.message : "unknown" });
    }
  }

  return NextResponse.json({ ok: true, dry_run: false, count: results.length, results });
}
