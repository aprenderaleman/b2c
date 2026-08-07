import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendRaw } from "@/lib/email/send";
import { getCertificateById } from "@/lib/certificates";
import PDFDocument from "pdfkit";
import { supabaseAdmin } from "@/lib/supabase";
import { certificateLevelLabel } from "@/lib/certificates";

function formatDateDE(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

async function generateCertPdf(cert: {
  id: string; type: string; title: string; description: string | null;
  issued_at: string; date_from: string | null; date_to: string | null;
  total_hours: number | null; teacher_name: string | null;
}, studentName: string): Promise<Buffer> {
  const levelLabel = certificateLevelLabel(cert.type as Parameters<typeof certificateLevelLabel>[0]);
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const NAVY = "#0f172a", ORANGE = "#ea580c", GRAY = "#64748b", LGRAY = "#94a3b8";

  doc.rect(20, 20, W - 40, H - 40).lineWidth(2.5).stroke(ORANGE);
  doc.rect(30, 30, W - 60, H - 60).lineWidth(0.5).stroke("#fed7aa");

  const corners = [
    { x: 35, y: 35, dx: 1, dy: 1 }, { x: W - 35, y: 35, dx: -1, dy: 1 },
    { x: 35, y: H - 35, dx: 1, dy: -1 }, { x: W - 35, y: H - 35, dx: -1, dy: -1 },
  ];
  for (const c of corners) {
    doc.moveTo(c.x, c.y + c.dy * 25).lineTo(c.x, c.y).lineTo(c.x + c.dx * 25, c.y).lineWidth(1.5).stroke(ORANGE);
  }

  let y = 55;
  doc.fontSize(11).fillColor(ORANGE).font("Helvetica-Bold").text("Aprender-Aleman.de", 0, y, { align: "center" });
  y += 16;
  doc.fontSize(9).fillColor(LGRAY).font("Helvetica").text("Online-Akademie für Deutsch als Fremdsprache", 0, y, { align: "center" });
  y += 40;
  doc.fontSize(38).fillColor(NAVY).font("Helvetica-Bold").text("ZERTIFIKAT", 0, y, { align: "center" });
  y += 52;
  doc.moveTo(W / 2 - 120, y).lineTo(W / 2 + 120, y).lineWidth(1).stroke(ORANGE);
  y += 22;
  doc.fontSize(12).fillColor(GRAY).font("Helvetica").text("Hiermit wird bestätigt, dass", 0, y, { align: "center" });
  y += 28;
  doc.fontSize(26).fillColor(NAVY).font("Helvetica-Bold").text(studentName, 0, y, { align: "center" });
  y += 40;

  if (levelLabel) {
    doc.fontSize(12).fillColor(GRAY).font("Helvetica")
      .text(`erfolgreich am Deutschkurs der Niveaustufe ${levelLabel}`, 80, y, { align: "center", width: W - 160 });
    y += 18;
    doc.text("gemäß dem Gemeinsamen Europäischen Referenzrahmen für Sprachen (GER)", 80, y, { align: "center", width: W - 160 });
    y += 18;
    doc.text("teilgenommen hat.", 80, y, { align: "center", width: W - 160 });
  }

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
    .text("Der Unterricht wurde online im Einzelunterricht mit", 0, y, { align: "center" });
  y += 14;
  doc.text("muttersprachlichen Lehrkräften durchgeführt.", 0, y, { align: "center" });

  y += 40;
  const issueDate = formatDateDE(cert.issued_at);
  doc.fontSize(10).fillColor(GRAY).font("Helvetica").text(`Berlin, den ${issueDate}`, 120, y, { width: 200 });
  doc.fontSize(10).fillColor(NAVY).font("Helvetica-Bold").text("Aprender-Aleman.de", W - 280, y, { width: 200 });
  y += 16;
  if (cert.teacher_name) {
    doc.fontSize(10).fillColor(GRAY).font("Helvetica").text(cert.teacher_name, W - 280, y, { width: 200 });
  }

  doc.fontSize(7).fillColor(LGRAY).font("Helvetica").text(`Zertifikat-Nr.: ${cert.id}`, 0, H - 48, { align: "center" });
  doc.end();
  return done;
}

export async function POST(req: Request) {
  // Auth: session OR internal secret (for CLI calls)
  const bearer = req.headers.get("authorization");
  const internalSecret = process.env.B2C_NOTIFY_SECRET || process.env.CRON_SECRET;
  const isSecretAuth = bearer && internalSecret && bearer === `Bearer ${internalSecret}`;

  if (!isSecretAuth) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const role = (session.user as { role: string }).role;
    if (role !== "admin" && role !== "superadmin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { studentId, certId, teacherEmail, teacherName } = await req.json();
  if (!studentId || !certId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: student } = await sb
    .from("students")
    .select("users!inner(full_name, email)")
    .eq("id", studentId)
    .maybeSingle();

  const uRaw = (student as { users: unknown } | null)?.users;
  const u = (Array.isArray(uRaw) ? uRaw[0] : uRaw) as { full_name: string; email: string };
  if (!u) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  const cert = await getCertificateById(certId);
  if (!cert) return NextResponse.json({ error: "cert_not_found" }, { status: 404 });

  const pdfBuffer = await generateCertPdf(cert, u.full_name);
  const results: Record<string, unknown> = {};

  // Email to student
  const studentHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <h2 style="color: #ea580c;">🎓 ¡Felicidades ${u.full_name.split(" ")[0]}!</h2>
  <p>¡Enhorabuena! 🎉 Has completado con éxito tu formación de alemán con nosotros y has alcanzado el <strong>nivel B2</strong>.</p>
  <p>Esto significa que ahora eres una usuaria independiente avanzada del idioma alemán, lista para desenvolverte con confianza en entornos profesionales y académicos en países de habla alemana.</p>
  <p>Tu certificado de Nivel B2 va adjunto a este correo y también está disponible en tu perfil:<br>
  <a href="https://b2c.aprender-aleman.de/estudiante/certificados" style="color: #ea580c;">Ver mis certificados</a></p>
  <p>Ha sido un placer acompañarte en este camino. Si en algún momento quieres seguir avanzando hacia el C1 o preparar un examen oficial, aquí estaremos.</p>
  <p>¡Mucho éxito en todo lo que viene!</p>
  <p>Un abrazo,<br><strong>Equipo Aprender-Aleman.de</strong></p>
</div>`;

  const studentText = `¡Felicidades ${u.full_name.split(" ")[0]}!

¡Enhorabuena! Has completado con éxito tu formación de alemán con nosotros y has alcanzado el nivel B2.

Tu certificado va adjunto a este correo y también está disponible en: https://b2c.aprender-aleman.de/estudiante/certificados

¡Mucho éxito en todo lo que viene!

Un abrazo,
Equipo Aprender-Aleman.de`;

  results.student = await sendRaw(
    u.email,
    `🎓 ¡Felicidades ${u.full_name.split(" ")[0]}! Has completado tu formación de alemán`,
    studentHtml,
    studentText,
    [{ filename: `Zertifikat-${u.full_name.replace(/\s+/g, "_")}-B2.pdf`, content: pdfBuffer }],
  );

  // Email to teacher
  if (teacherEmail) {
    const tName = teacherName || "profesor/a";
    const teacherHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <p>Hola ${tName.split(" ")[0]},</p>
  <p>Te informo que tu estudiante <strong>${u.full_name}</strong> ha completado su pack de ${cert.total_hours} clases y ha alcanzado el <strong>nivel B2</strong>. Su cuenta ha sido cerrada y se le ha emitido su certificado de nivel.</p>
  <p>¡Buen trabajo!</p>
  <p>Saludos,<br><strong>Equipo Aprender-Aleman.de</strong></p>
</div>`;
    const teacherText = `Hola ${tName.split(" ")[0]},\n\nTe informo que tu estudiante ${u.full_name} ha completado su pack de ${cert.total_hours} clases y ha alcanzado el nivel B2. Su cuenta ha sido cerrada y se le ha emitido su certificado de nivel.\n\n¡Buen trabajo!\n\nSaludos,\nEquipo Aprender-Aleman.de`;

    results.teacher = await sendRaw(
      teacherEmail,
      `${u.full_name} ha completado su formación — Nivel B2`,
      teacherHtml,
      teacherText,
    );
  }

  return NextResponse.json({ ok: true, results });
}
