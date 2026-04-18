import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getCertificateById } from "@/lib/certificates";

/**
 * GET /api/certificates/[id]/pdf
 *
 * Streams a branded PDF for a given certificate. Access-gated: student
 * can only download their own; teacher/admin can download any.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const cert = await getCertificateById(id);
  if (!cert) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const role   = (session.user as { role: string }).role;
  const userId = (session.user as { id: string }).id;

  // Students can only fetch their own cert.
  if (role === "student") {
    const sb = supabaseAdmin();
    const { data: student } = await sb.from("students").select("user_id").eq("id", cert.student_id).maybeSingle();
    if ((student as { user_id?: string } | null)?.user_id !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Fetch the student name for the certificate.
  const sb = supabaseAdmin();
  const { data: s } = await sb
    .from("students")
    .select("users!inner(full_name, email)")
    .eq("id", cert.student_id)
    .maybeSingle();
  const uRaw = (s as { users: unknown } | null)?.users;
  const u = (Array.isArray(uRaw) ? uRaw[0] : uRaw) as { full_name: string | null; email: string } | undefined;
  const studentName = u?.full_name ?? u?.email ?? "Estudiante";

  // Build the PDF in memory.
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // Border
  doc.rect(25, 25, doc.page.width - 50, doc.page.height - 50).lineWidth(3).stroke("#f97316");
  doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80).lineWidth(0.5).stroke("#fed7aa");

  // Brand header
  doc.fontSize(14).fillColor("#ea580c").text("Aprender-Aleman.de", 0, 70, { align: "center" });
  doc.fontSize(10).fillColor("#78716c").text("Academia Premium Online", { align: "center" });

  // Title
  doc.moveDown(3);
  doc.fontSize(36).fillColor("#0f172a").font("Helvetica-Bold").text("Certificado", { align: "center" });

  // Body
  doc.moveDown(1.2);
  doc.fontSize(14).fillColor("#334155").font("Helvetica").text("Se otorga el presente certificado a", { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(28).fillColor("#0f172a").font("Helvetica-Bold").text(studentName, { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(14).fillColor("#334155").font("Helvetica").text("por", { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(20).fillColor("#ea580c").font("Helvetica-Bold").text(cert.title, { align: "center" });

  if (cert.description) {
    doc.moveDown(0.6);
    doc.fontSize(11).fillColor("#64748b").font("Helvetica").text(cert.description, 100, doc.y, {
      align: "center",
      width:  doc.page.width - 200,
    });
  }

  // Footer — date + signature
  doc.moveDown(2.5);
  const issueDate = new Date(cert.issued_at).toLocaleDateString("es-ES", {
    year: "numeric", month: "long", day: "numeric",
  });
  doc.fontSize(11).fillColor("#64748b").text(`Emitido el ${issueDate}`, { align: "center" });
  doc.moveDown(1);
  doc.fontSize(10).fillColor("#78716c").text("Stiv Horn · Aprender-Aleman.de", { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor("#a3a3a3").text(`ID: ${cert.id}`, { align: "center" });

  doc.end();

  const buf = await done;
  const filename = `certificado-${cert.type}-${studentName.replace(/\s+/g, "_")}.pdf`;
  // Copy into a fresh ArrayBuffer — TS typings disagree about Buffer vs BodyInit
  // here (it works at runtime but the compiler complains).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length":      String(buf.byteLength),
    },
  });
}
