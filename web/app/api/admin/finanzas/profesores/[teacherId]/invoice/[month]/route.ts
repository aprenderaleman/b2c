import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildTeacherInvoicePdf } from "@/lib/finance/teacher-invoice-pdf";

// pdfkit needs Node.js APIs (fs for its built-in fonts) — force the Node
// runtime, not Edge. Same reason /api/certificates and similar do.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/finanzas/profesores/{teacherId}/invoice/{month}
 *
 * Streams a PDF invoice for (teacher, YYYY-MM) — the admin clicks "PDF ↓"
 * on /admin/finanzas/profesores. The PDF generation lives in
 * lib/finance/teacher-invoice-pdf.ts so the same buffer can be attached
 * to the "te hemos pagado" email when the admin marks the row paid.
 * Admin-only.
 */
export async function GET(
  _req:   NextRequest,
  { params }: { params: Promise<{ teacherId: string; month: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || !(role === "admin" || role === "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { teacherId, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  let invoice;
  try {
    invoice = await buildTeacherInvoicePdf({ teacherId, month });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "teacher_not_found") {
      return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "pdf_failed", message: msg }, { status: 500 });
  }

  return new NextResponse(invoice.pdfBuffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
