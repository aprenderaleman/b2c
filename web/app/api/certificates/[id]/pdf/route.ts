import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getCertificateById, certificateLevelLabel } from "@/lib/certificates";
import { issueGarantiaCertificate } from "@/lib/garantia-cert";

function formatDateDE(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

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

  if (role === "student") {
    const sb = supabaseAdmin();
    const { data: student } = await sb.from("students").select("user_id").eq("id", cert.student_id).maybeSingle();
    if ((student as { user_id?: string } | null)?.user_id !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const sb = supabaseAdmin();
  const { data: s } = await sb
    .from("students")
    .select("users!inner(full_name, email)")
    .eq("id", cert.student_id)
    .maybeSingle();
  const uRaw = (s as { users: unknown } | null)?.users;
  const u = (Array.isArray(uRaw) ? uRaw[0] : uRaw) as { full_name: string | null; email: string } | undefined;
  const studentName = u?.full_name ?? u?.email ?? "Teilnehmer/in";

  // La Garantía de Nivel tiene su propia plantilla (A4 vertical,
  // navy/dorado, español) — regenerada desde la metadata del cert.
  if (cert.type === "garantia_nivel") {
    const issued = await issueGarantiaCertificate({
      studentId:      cert.student_id,
      nombreCompleto: studentName,
      // source se ignora: el cert ya existe y se regenera de su metadata
      source: { meta: null, ritmo: null, tipoPago: null, clasesTotales: null, fechaConversion: new Date(cert.issued_at) },
    });
    if (!issued) return NextResponse.json({ error: "pdf_failed" }, { status: 500 });
    const ab = new ArrayBuffer(issued.pdfBuffer.byteLength);
    new Uint8Array(ab).set(issued.pdfBuffer);
    return new NextResponse(ab, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Garantia-de-Nivel-${(studentName || "estudiante").replace(/[^a-zA-Z0-9]+/g, "-")}.pdf"`,
        "Content-Length": String(issued.pdfBuffer.byteLength),
      },
    });
  }

  const levelLabel = certificateLevelLabel(cert.type);
  const isLevelCert = !!levelLabel;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const NAVY    = "#0f172a";
  const ORANGE  = "#ea580c";
  const GRAY    = "#64748b";
  const LGRAY   = "#94a3b8";

  // === BORDERS ===
  doc.rect(20, 20, W - 40, H - 40).lineWidth(2.5).stroke(ORANGE);
  doc.rect(30, 30, W - 60, H - 60).lineWidth(0.5).stroke("#fed7aa");

  // === CORNER ORNAMENTS (simple L-shapes) ===
  const corners = [
    { x: 35, y: 35, dx: 1, dy: 1 },
    { x: W - 35, y: 35, dx: -1, dy: 1 },
    { x: 35, y: H - 35, dx: 1, dy: -1 },
    { x: W - 35, y: H - 35, dx: -1, dy: -1 },
  ];
  for (const c of corners) {
    doc.moveTo(c.x, c.y + c.dy * 25)
       .lineTo(c.x, c.y)
       .lineTo(c.x + c.dx * 25, c.y)
       .lineWidth(1.5).stroke(ORANGE);
  }

  // === HEADER ===
  let y = 55;
  doc.fontSize(11).fillColor(ORANGE).font("Helvetica-Bold")
     .text("Aprender-Aleman.de", 0, y, { align: "center" });
  y += 16;
  doc.fontSize(9).fillColor(LGRAY).font("Helvetica")
     .text("Online-Akademie für Deutsch als Fremdsprache", 0, y, { align: "center" });

  // === TITLE ===
  y += 40;
  doc.fontSize(38).fillColor(NAVY).font("Helvetica-Bold")
     .text("ZERTIFIKAT", 0, y, { align: "center" });

  // === DECORATIVE LINE ===
  y += 52;
  const lineW = 120;
  doc.moveTo(W / 2 - lineW, y).lineTo(W / 2 + lineW, y).lineWidth(1).stroke(ORANGE);

  // === BODY ===
  y += 22;
  doc.fontSize(12).fillColor(GRAY).font("Helvetica")
     .text("Hiermit wird bestätigt, dass", 0, y, { align: "center" });

  y += 28;
  doc.fontSize(26).fillColor(NAVY).font("Helvetica-Bold")
     .text(studentName, 0, y, { align: "center" });

  y += 40;
  if (isLevelCert) {
    doc.fontSize(12).fillColor(GRAY).font("Helvetica")
       .text(
         `erfolgreich am Deutschkurs der Niveaustufe ${levelLabel}`,
         80, y, { align: "center", width: W - 160 },
       );
    y += 18;
    doc.text(
      "gemäß dem Gemeinsamen Europäischen Referenzrahmen für Sprachen (GER)",
      80, y, { align: "center", width: W - 160 },
    );
    y += 18;
    doc.text("teilgenommen hat.", 80, y, { align: "center", width: W - 160 });
  } else {
    doc.fontSize(12).fillColor(GRAY).font("Helvetica")
       .text(cert.title, 80, y, { align: "center", width: W - 160 });
    if (cert.description) {
      y += 20;
      doc.fontSize(11).text(cert.description, 80, y, { align: "center", width: W - 160 });
    }
  }

  // === COURSE DETAILS ===
  y += 38;
  if (cert.date_from && cert.date_to) {
    doc.fontSize(10).fillColor(NAVY).font("Helvetica-Bold")
       .text(`Kurszeitraum: ${formatDateDE(cert.date_from)} bis ${formatDateDE(cert.date_to)}`, 0, y, { align: "center" });
    y += 16;
  }
  if (cert.total_hours) {
    doc.fontSize(10).fillColor(NAVY).font("Helvetica-Bold")
       .text(`Gesamtstundenzahl: ${cert.total_hours} Unterrichtsstunden`, 0, y, { align: "center" });
    y += 16;
  }

  y += 6;
  doc.fontSize(9.5).fillColor(GRAY).font("Helvetica")
     .text(
       "Der Unterricht wurde online im Einzelunterricht mit",
       0, y, { align: "center" },
     );
  y += 14;
  doc.text("muttersprachlichen Lehrkräften durchgeführt.", 0, y, { align: "center" });

  // === FOOTER ===
  y += 40;

  // Date + signature — two columns
  const issueDate = formatDateDE(cert.issued_at);
  const colLeft  = 120;
  const colRight = W - 280;

  // Left: date
  doc.fontSize(10).fillColor(GRAY).font("Helvetica")
     .text(`Berlin, den ${issueDate}`, colLeft, y, { width: 200 });

  // Right: academy + teacher
  doc.fontSize(10).fillColor(NAVY).font("Helvetica-Bold")
     .text("Aprender-Aleman.de", colRight, y, { width: 200 });
  y += 16;
  if (cert.teacher_name) {
    doc.fontSize(10).fillColor(GRAY).font("Helvetica")
       .text(cert.teacher_name, colRight, y, { width: 200 });
  }

  // === CERTIFICATE ID ===
  doc.fontSize(7).fillColor(LGRAY).font("Helvetica")
     .text(`Zertifikat-Nr.: ${cert.id}`, 0, H - 48, { align: "center" });

  doc.end();

  const buf = await done;
  const filename = `Zertifikat-${studentName.replace(/\s+/g, "_")}.pdf`;
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
