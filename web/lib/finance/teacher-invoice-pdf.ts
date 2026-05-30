import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Shared builder for the monthly teacher-payroll PDF.
 *
 * Used by:
 *   - GET /api/admin/finanzas/profesores/[teacherId]/invoice/[month]
 *     (admin clicks "PDF ↓" to download)
 *   - The mark-paid hook in /api/admin/finanzas/earnings/[id]/pay
 *     (auto-emailed to the teacher as an attachment)
 *
 * Returns the PDF buffer plus the metadata the email template needs
 * (teacher name/email, monthly total, billed hours, payment method).
 *
 * Pure data + pdfkit. No HTTP, no auth — caller's job.
 */
export type TeacherInvoiceData = {
  pdfBuffer:    Buffer;
  filename:     string;
  monthLabel:   string;            // "abril 2026"
  totalCents:   number;
  totalHours:   number;
  classesCount: number;
  currency:     string;            // "EUR"
  teacher: {
    fullName:      string;
    email:         string;
    phone:         string | null;
    paymentMethod: string | null;
  };
};

export async function buildTeacherInvoicePdf(args: {
  teacherId: string;
  month:     string;               // "YYYY-MM"
}): Promise<TeacherInvoiceData> {
  if (!/^\d{4}-\d{2}$/.test(args.month)) {
    throw new Error("month must be YYYY-MM");
  }

  const sb = supabaseAdmin();

  // Teacher + rates
  const { data: teacher } = await sb
    .from("teachers")
    .select(`
      id, rate_group_cents, rate_individual_cents, currency, payment_method,
      user:users!inner(full_name, email, phone)
    `)
    .eq("id", args.teacherId)
    .maybeSingle();
  if (!teacher) throw new Error("teacher_not_found");

  const userRaw = (teacher as { user: unknown }).user;
  const u = (Array.isArray(userRaw) ? userRaw[0] : userRaw) as {
    full_name: string | null;
    email:     string;
    phone:     string | null;
  };

  // Month bounds
  const [y, m] = args.month.split("-").map(Number);
  const monthStart = `${args.month}-01T00:00:00Z`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1     : m + 1;
  const monthEnd = `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`;

  // Lectura desde class_hours_log — SOURCE OF TRUTH del importe a pagar.
  // El rollup mensual a teacher_earnings viene de class_hours_log, así
  // que el PDF debe leer del mismo lugar para que cuadre con el email.
  //
  // BUG fixed 2026-05-30: ANTES filtrábamos por chl.created_at, lo cual
  // dejaba clases de otro mes mezcladas (caso Vero 04-13 logueado en
  // mayo) y peor — escondía facturas de clases que se loguearon antes
  // del mes (la factura quedaba casi vacía, 2.8KB). Ahora filtramos por
  // class.scheduled_at, que es la verdad de cuándo se dio la clase.
  // Filtramos por chl.created_at — IGUAL que `recompute_teacher_month`
  // — para que el TOTAL del PDF cuadre siempre con teacher_earnings.
  // El carryover de meses previos (caso Vero 04-29 backfilleada en mayo)
  // cae aquí porque su log se creó en mayo. En el render lo separamos
  // en una sección "Pendientes de meses anteriores" para que el profe
  // entienda por qué aparece una clase de un mes que ya cobró.
  const { data: hoursLog } = await sb
    .from("class_hours_log")
    .select(`
      id, created_at, duration_minutes, amount_cents, rate_at_time,
      class:classes!inner(
        id, started_at, scheduled_at, type, title,
        group:student_groups(name),
        class_participants(
          student:students!inner(user:users!inner(full_name))
        )
      )
    `)
    .eq("teacher_id", args.teacherId)
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  type ParticipantRow = {
    student: { user: { full_name: string | null } | Array<{ full_name: string | null }> }
           | Array<{ user: { full_name: string | null } | Array<{ full_name: string | null }> }>;
  };
  type ClassShape = {
    id: string;
    started_at:   string | null;
    scheduled_at: string;
    type: "group" | "individual";
    title:        string | null;
    group: { name: string } | { name: string }[] | null;
    class_participants: ParticipantRow[] | null;
  };
  type LogRow = {
    id:               string;
    duration_minutes: number;
    amount_cents:     number;
    rate_at_time:     string | number;
    class: ClassShape | ClassShape[];
  };
  const logRowsRaw = (hoursLog ?? []) as LogRow[];

  type FlatRow = {
    started_at:      string;          // class.started_at or scheduled_at
    type:            "group" | "individual";
    duration_min:    number;
    amount_cents:    number;
    rate_cents_per_h: number;
    label:           string;          // group name OR student name OR class title
    isCarryover:     boolean;         // true if class.scheduled_at < monthStart
  };
  const monthStartMs = new Date(monthStart).getTime();
  const monthEndMs   = new Date(monthEnd).getTime();
  const allRows: FlatRow[] = logRowsRaw.map(r => {
    const c: ClassShape = Array.isArray(r.class) ? r.class[0] : r.class;
    const groupRaw = c?.group;
    const groupName = Array.isArray(groupRaw) ? (groupRaw[0]?.name ?? null) : (groupRaw?.name ?? null);
    // For individual classes, gather the student names from participants
    // so the invoice doesn't say "—" or blank.
    const studentNames: string[] = [];
    for (const p of (c?.class_participants ?? [])) {
      const s = Array.isArray(p.student) ? p.student[0] : p.student;
      const u2 = Array.isArray(s?.user) ? s.user[0] : s?.user;
      const name = u2?.full_name?.trim();
      if (name) studentNames.push(name);
    }
    // Pick best label per row:
    //  · group class → group name (fallback class title, fallback "Grupo")
    //  · individual  → student name (fallback class title, fallback "Clase individual")
    let label: string;
    if (c?.type === "group") {
      label = groupName ?? c?.title ?? "Grupo";
    } else {
      label = studentNames.join(", ") || (c?.title ?? "Clase individual");
    }
    const date_iso = c?.started_at ?? c?.scheduled_at ?? "";
    // Carryover = clase agendada antes del mes que se factura.
    let isCarryover = false;
    if (c?.scheduled_at) {
      const t = new Date(c.scheduled_at).getTime();
      if (!Number.isNaN(t) && t < monthStartMs) isCarryover = true;
      // Si la clase está agendada en un mes FUTURO al de la factura
      // (raro pero defensivo), también la tratamos como carryover para
      // que aparezca en la sección aparte, no enmascarada.
      if (!Number.isNaN(t) && t >= monthEndMs) isCarryover = true;
    }
    return {
      started_at:       date_iso,
      type:             c?.type ?? "individual",
      duration_min:     Number(r.duration_minutes),
      amount_cents:     Number(r.amount_cents),
      rate_cents_per_h: Math.round(Number(r.rate_at_time) * 100),
      label,
      isCarryover,
    };
  }).sort((a, b) => a.started_at.localeCompare(b.started_at));

  const rows         = allRows.filter(r => !r.isCarryover);
  const carryoverRows = allRows.filter(r =>  r.isCarryover);

  // El total del PDF incluye carryover — debe cuadrar con teacher_earnings.
  let totalCents = 0;
  let totalHours = 0;
  for (const r of allRows) {
    totalCents += r.amount_cents;
    totalHours += r.duration_min / 60;
  }

  // ── Render PDF
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const donePromise: Promise<Buffer> = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const euros   = (c: number) => (c / 100).toFixed(2) + " €";
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
     .text(`Grupal: ${rateEur((teacher as { rate_group_cents:      number }).rate_group_cents)} €/h`, 320, 197)
     .text(`Individual: ${rateEur((teacher as { rate_individual_cents: number }).rate_individual_cents)} €/h`, 320, 212);

  // Table header
  let y0 = 260;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569");
  doc.text("FECHA",              50,  y0);
  doc.text("GRUPO / ALUMNO",     115, y0);
  doc.text("TIPO",               340, y0, { width: 60 });
  doc.text("MIN",                400, y0, { width: 40, align: "right" });
  doc.text("TARIFA",             450, y0, { width: 50, align: "right" });
  doc.text("IMPORTE",            500, y0, { width: 50, align: "right" });
  doc.moveTo(50, y0 + 15).lineTo(550, y0 + 15).strokeColor("#cbd5e1").stroke();

  // Rows
  y0 += 22;
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  // Trunca con ellipsis manual para evitar wrap a 2 líneas que solapa.
  const truncate = (s: string, max: number): string =>
    s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
  // Etiquetas más legibles para el tipo (en español).
  const typeLabel = (t: "group" | "individual") => t === "group" ? "Grupal" : "Individual";
  // Filas alternadas con fondo zebra para legibilidad.
  let rowIdx = 0;
  const ROW_H  = 20;
  const TABLE_LEFT = 48;
  const TABLE_RIGHT = 552;
  for (const r of rows) {
    if (y0 > 720) { doc.addPage(); y0 = 60; }

    if (rowIdx % 2 === 1) {
      doc.rect(TABLE_LEFT, y0 - 4, TABLE_RIGHT - TABLE_LEFT, ROW_H)
         .fillColor("#f8fafc").fill();
    }
    doc.fillColor("#0f172a");

    let dateStr = "—";
    if (r.started_at) {
      const d = new Date(r.started_at);
      if (!Number.isNaN(d.getTime())) {
        dateStr = d.toISOString().slice(0, 10);
      }
    }
    const label = truncate(r.label, 36);

    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    doc.text(dateStr,                       50,  y0, { width: 60,  lineBreak: false });
    doc.text(label,                         115, y0, { width: 220, lineBreak: false });
    doc.text(typeLabel(r.type),             340, y0, { width: 60,  lineBreak: false });
    doc.text(String(r.duration_min),        400, y0, { width: 40,  lineBreak: false, align: "right" });
    doc.text(rateEur(r.rate_cents_per_h),   450, y0, { width: 50,  lineBreak: false, align: "right" });
    doc.text(euros(r.amount_cents),         500, y0, { width: 50,  lineBreak: false, align: "right" });

    y0 += ROW_H;
    rowIdx++;
  }

  if (rows.length === 0) {
    doc.font("Helvetica-Oblique").fillColor("#94a3b8").text("Sin clases facturables este mes.", 50, y0);
    y0 += 20;
  }

  // ───── Carryover: clases de meses anteriores facturadas este mes ─────
  if (carryoverRows.length > 0) {
    if (y0 > 660) { doc.addPage(); y0 = 60; }
    y0 += 14;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
       .text("Pendientes de meses anteriores", 50, y0);
    y0 += 4;
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#64748b")
       .text("Clases de meses previos que se facturan en esta nómina (ajustes y horas que quedaron sin facturar a tiempo).",
             50, y0 + 12, { width: 500 });
    y0 += 34;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569");
    doc.text("FECHA",              50,  y0);
    doc.text("GRUPO / ALUMNO",     115, y0);
    doc.text("TIPO",               340, y0, { width: 60 });
    doc.text("MIN",                400, y0, { width: 40, align: "right" });
    doc.text("TARIFA",             450, y0, { width: 50, align: "right" });
    doc.text("IMPORTE",            500, y0, { width: 50, align: "right" });
    doc.moveTo(50, y0 + 13).lineTo(550, y0 + 13).strokeColor("#cbd5e1").stroke();
    y0 += 20;
    let cIdx = 0;
    for (const r of carryoverRows) {
      if (y0 > 760) { doc.addPage(); y0 = 60; }
      if (cIdx % 2 === 1) {
        doc.rect(TABLE_LEFT, y0 - 4, TABLE_RIGHT - TABLE_LEFT, ROW_H).fillColor("#fef3c7").fill();
      } else {
        doc.rect(TABLE_LEFT, y0 - 4, TABLE_RIGHT - TABLE_LEFT, ROW_H).fillColor("#fffbeb").fill();
      }
      let dateStr = "—";
      if (r.started_at) {
        const d = new Date(r.started_at);
        if (!Number.isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
      }
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      doc.text(dateStr,                       50,  y0, { width: 60,  lineBreak: false });
      doc.text(truncate(r.label, 36),         115, y0, { width: 220, lineBreak: false });
      doc.text(typeLabel(r.type),             340, y0, { width: 60,  lineBreak: false });
      doc.text(String(r.duration_min),        400, y0, { width: 40,  lineBreak: false, align: "right" });
      doc.text(rateEur(r.rate_cents_per_h),   450, y0, { width: 50,  lineBreak: false, align: "right" });
      doc.text(euros(r.amount_cents),         500, y0, { width: 50,  lineBreak: false, align: "right" });
      y0 += ROW_H;
      cIdx++;
    }
  }

  // ───── Resumen por grupo/alumno ─────
  // Incluye clases del mes + carryover, para que el resumen cuadre con
  // el total a pagar.
  type Bucket = { label: string; type: "group" | "individual"; classes: number; minutes: number; cents: number };
  const buckets = new Map<string, Bucket>();
  for (const r of allRows) {
    const key = r.type + ":" + r.label;
    const b = buckets.get(key) ?? { label: r.label, type: r.type, classes: 0, minutes: 0, cents: 0 };
    b.classes += 1;
    b.minutes += r.duration_min;
    b.cents   += r.amount_cents;
    buckets.set(key, b);
  }
  const summary = [...buckets.values()].sort((a, b) => b.cents - a.cents);

  if (summary.length > 0) {
    if (y0 > 650) { doc.addPage(); y0 = 60; }
    y0 += 16;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
       .text("Resumen por grupo / alumno", 50, y0);
    y0 += 18;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569");
    doc.text("GRUPO / ALUMNO",     50,  y0);
    doc.text("TIPO",               300, y0, { width: 60 });
    doc.text("CLASES",             360, y0, { width: 50, align: "right" });
    doc.text("MIN",                415, y0, { width: 50, align: "right" });
    doc.text("IMPORTE",            475, y0, { width: 75, align: "right" });
    doc.moveTo(50, y0 + 13).lineTo(550, y0 + 13).strokeColor("#cbd5e1").stroke();
    y0 += 20;
    let idx = 0;
    for (const b of summary) {
      if (y0 > 760) { doc.addPage(); y0 = 60; }
      if (idx % 2 === 1) {
        doc.rect(TABLE_LEFT, y0 - 4, TABLE_RIGHT - TABLE_LEFT, ROW_H)
           .fillColor("#f8fafc").fill();
      }
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      doc.text(truncate(b.label, 40),       50,  y0, { width: 250, lineBreak: false });
      doc.text(typeLabel(b.type),           300, y0, { width: 60,  lineBreak: false });
      doc.text(String(b.classes),           360, y0, { width: 50,  lineBreak: false, align: "right" });
      doc.text(String(b.minutes),           415, y0, { width: 50,  lineBreak: false, align: "right" });
      doc.text(euros(b.cents),              475, y0, { width: 75,  lineBreak: false, align: "right" });
      y0 += ROW_H;
      idx++;
    }
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
  const pdfBuffer = await donePromise;

  const filename = `factura-${(u.full_name ?? "profesor").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${args.month}.pdf`;

  return {
    pdfBuffer,
    filename,
    monthLabel,
    totalCents,
    totalHours,
    classesCount: rows.length,
    currency: ((teacher as { currency: string | null }).currency ?? "EUR"),
    teacher: {
      fullName:      u.full_name ?? u.email,
      email:         u.email,
      phone:         u.phone,
      paymentMethod: (teacher as { payment_method: string | null }).payment_method ?? null,
    },
  };
}
