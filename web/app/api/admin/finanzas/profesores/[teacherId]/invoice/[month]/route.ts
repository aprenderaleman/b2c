import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

// pdfkit needs Node.js APIs (fs for its built-in fonts) — force the Node
// runtime, not Edge. Same reason /api/certificates and similar do.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/finanzas/profesores/{teacherId}/invoice/{month}
 *
 * Streams a PDF invoice for (teacher, YYYY-MM). Lists every class with its
 * date, group name, billed hours, rate snapshot, and amount, plus a total.
 * Admin-only.
 */
export async function GET(
  req:    NextRequest,
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

  const sb = supabaseAdmin();

  // Teacher + rates
  const { data: teacher } = await sb
    .from("teachers")
    .select(`
      id, rate_group_cents, rate_individual_cents, currency, payment_method,
      user:users!inner(full_name, email, phone)
    `)
    .eq("id", teacherId)
    .maybeSingle();

  if (!teacher) return NextResponse.json({ error: "teacher not found" }, { status: 404 });

  const userRaw = (teacher as { user: unknown }).user;
  const u = (Array.isArray(userRaw) ? userRaw[0] : userRaw) as { full_name: string | null; email: string; phone: string | null };

  // Classes taught in that month with their billed hours & group name
  const monthStart = `${month}-01T00:00:00Z`;
  // monthEnd = first day of next month
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1     : m + 1;
  const monthEnd = `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`;

  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, started_at, billed_hours, type,
      group:student_groups(name)
    `)
    .eq("teacher_id", teacherId)
    .eq("status", "completed")
    .gt("billed_hours", 0)
    .gte("started_at", monthStart)
    .lt("started_at", monthEnd)
    .order("started_at", { ascending: true });

  type ClsRow = {
    id: string; started_at: string; billed_hours: number; type: "group" | "individual";
    group: { name: string } | { name: string }[] | null;
  };
  const rows = (classes ?? []) as ClsRow[];

  // Compute monthly total
  const rate = (t: "group" | "individual") =>
    t === "individual"
      ? (teacher as { rate_individual_cents: number }).rate_individual_cents
      : (teacher as { rate_group_cents:      number }).rate_group_cents;

  let totalCents = 0;
  for (const r of rows) totalCents += r.billed_hours * rate(r.type);

  // --- Render PDF
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const donePromise: Promise<Buffer> = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const euros = (c: number) => (c / 100).toFixed(2) + " €";
  const rateEur = (c: number) => (c / 100).toFixed(2);
  const MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const monthLabel = `${MONTHS_ES[m - 1]} ${y}`;

  // Header
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Aprender-Aleman.de", 50, 50);
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("aprender-aleman.de · Gelfis Horn", 50, 76);

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("Factura de horas docentes", 50, 110);
  doc.font("Helvetica").fontSize(11).fillColor("#334155").text(`Periodo: ${monthLabel}`, 50, 130);
  doc.text(`Emitido: ${new Date().toISOString().slice(0, 10)}`, 50, 145);

  // Teacher block
  doc.rect(50, 170, 500, 70).fillAndStroke("#f8fafc", "#e2e8f0");
  doc.fillColor("#64748b").font("Helvetica").fontSize(9).text("PROFESOR", 60, 180);
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(u.full_name ?? "—", 60, 194);
  doc.fillColor("#475569").font("Helvetica").fontSize(10).text(u.email, 60, 211);
  if (u.phone) doc.text(u.phone, 60, 225);
  doc.fillColor("#64748b").fontSize(9).text("TARIFAS", 320, 180);
  doc.fillColor("#0f172a").font("Helvetica").fontSize(10)
     .text(`Grupal: ${rateEur((teacher as { rate_group_cents: number }).rate_group_cents)} €/h`, 320, 197)
     .text(`Individual: ${rateEur((teacher as { rate_individual_cents: number }).rate_individual_cents)} €/h`, 320, 212);

  // Table header
  let y0 = 260;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569");
  doc.text("FECHA",  50,  y0);
  doc.text("GRUPO",  115, y0);
  doc.text("TIPO",   340, y0, { width: 60 });
  doc.text("HORAS",  400, y0, { width: 40, align: "right" });
  doc.text("TARIFA", 450, y0, { width: 50, align: "right" });
  doc.text("IMPORTE",500, y0, { width: 50, align: "right" });
  doc.moveTo(50, y0 + 15).lineTo(550, y0 + 15).strokeColor("#cbd5e1").stroke();

  // Rows
  y0 += 22;
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  for (const r of rows) {
    if (y0 > 750) { doc.addPage(); y0 = 60; }
    const groupRaw = r.group as { name: string } | { name: string }[] | null;
    const groupName = Array.isArray(groupRaw) ? groupRaw[0]?.name : groupRaw?.name;
    const dateStr = new Date(r.started_at).toISOString().slice(0, 10);
    const rc = rate(r.type);
    const amt = r.billed_hours * rc;
    doc.text(dateStr,                50,  y0);
    doc.text(groupName ?? "—",        115, y0, { width: 220, ellipsis: true });
    doc.text(r.type,                  340, y0, { width: 60 });
    doc.text(String(r.billed_hours) + "h", 400, y0, { width: 40, align: "right" });
    doc.text(rateEur(rc),             450, y0, { width: 50, align: "right" });
    doc.text(euros(amt),              500, y0, { width: 50, align: "right" });
    y0 += 16;
  }

  if (rows.length === 0) {
    doc.font("Helvetica-Oblique").fillColor("#94a3b8").text("Sin clases facturables este mes.", 50, y0);
    y0 += 20;
  }

  // Total box
  doc.moveTo(50, y0 + 8).lineTo(550, y0 + 8).strokeColor("#cbd5e1").stroke();
  doc.rect(340, y0 + 18, 210, 42).fillAndStroke("#0f172a", "#0f172a");
  doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9).text("TOTAL A PAGAR", 355, y0 + 26);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(euros(totalCents), 355, y0 + 36, { width: 180, align: "right" });

  // Footer
  doc.font("Helvetica").fontSize(8).fillColor("#94a3b8").text(
    `Factura generada automáticamente por la plataforma de Aprender-Aleman.de — ${new Date().toISOString().slice(0, 10)}`,
    50, 790,
    { width: 500, align: "center" },
  );
  if ((teacher as { payment_method: string | null }).payment_method) {
    doc.fillColor("#475569").fontSize(9).text(
      "Pago a: " + (teacher as { payment_method: string }).payment_method,
      50, 770, { width: 500, align: "center" },
    );
  }

  doc.end();
  const pdfBuf = await donePromise;

  const filename = `factura-${(u.full_name ?? "profesor").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}.pdf`;
  return new NextResponse(pdfBuf as unknown as ArrayBuffer, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
