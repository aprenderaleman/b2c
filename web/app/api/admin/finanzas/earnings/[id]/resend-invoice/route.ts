import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendInvoicePaidEmails } from "@/lib/finance/send-invoice-paid";

export const runtime = "nodejs";

/**
 * POST /api/admin/finanzas/earnings/[id]/resend-invoice
 *
 * Re-dispara el envío del email de factura al profesor + copia archivo
 * al admin SIN tocar el flag `paid` ni `paid_at`. Útil cuando el envío
 * original falló (caso típico: backend de email no configurado, Resend
 * caído, etc.).
 *
 * La fila DEBE estar marcada como paid=true para evitar enviar facturas
 * de pagos no realizados.
 *
 * Devuelve un JSON con el resultado de cada envío para feedback en UI.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();

  // Asegurar que la fila existe y está paid (no enviar facturas no pagadas).
  const { data: earnings } = await sb
    .from("teacher_earnings")
    .select("id, paid, payment_reference")
    .eq("id", id)
    .maybeSingle();
  if (!earnings) {
    return NextResponse.json({ error: "earnings_not_found" }, { status: 404 });
  }
  const e = earnings as { paid: boolean; payment_reference: string | null };
  if (!e.paid) {
    return NextResponse.json(
      { error: "not_paid", message: "Esta nómina aún no está marcada como pagada." },
      { status: 400 },
    );
  }

  const result = await sendInvoicePaidEmails(id, e.payment_reference);
  if (!result) {
    return NextResponse.json({ error: "earnings_user_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok:      result.teacherEmail.ok && (!result.adminEmail || result.adminEmail.ok),
    teacher: result.teacherEmail,
    admin:   result.adminEmail,
  });
}
