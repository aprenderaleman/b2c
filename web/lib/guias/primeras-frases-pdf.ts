import PDFDocument from "pdfkit";
import { GUIAS, type GuiaNivel } from "./primeras-frases";

const NAVY   = "#0f172a";
const ORANGE = "#ea580c";
const GRAY   = "#64748b";
const LGRAY  = "#94a3b8";
const LINE   = "#e2e8f0";
const CREAM  = "#fff7ed";

/** PDF A4 vertical con la guía del nivel. Mismos colores y fuentes que los certificados. */
export async function renderGuiaPrimerasFrases(nivel: GuiaNivel, nombre: string | null): Promise<Buffer> {
  const guia = GUIAS[nivel];
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 60, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: `Tus primeras 30 frases en alemán (${nivel})`, Author: "Aprender-Aleman.de" },
  });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const L = 50;
  const CW = W - 100;
  const bottom = () => doc.page.height - 70;

  // Cabecera
  doc.rect(0, 0, W, 150).fill(NAVY);
  doc.rect(0, 150, W, 4).fill(ORANGE);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ORANGE)
    .text("APRENDER-ALEMAN.DE  ·  REGALO DE BIENVENIDA", L, 38, { characterSpacing: 1.5 });
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#ffffff")
    .text("Tus primeras 30 frases en alemán", L, 58, { width: CW });
  doc.font("Helvetica").fontSize(13).fillColor("#cbd5e1")
    .text(guia.subtitulo, L, 96, { width: CW });
  if (nombre) {
    doc.font("Helvetica").fontSize(10).fillColor(LGRAY)
      .text(`Preparada para ${nombre}`, L, 120, { width: CW });
  }

  doc.font("Helvetica").fontSize(10.5).fillColor(GRAY)
    .text(guia.intro, L, 176, { width: CW, lineGap: 3 });
  doc.moveDown(1.2);

  const colDe = 260;
  const colEs = CW - colDe - 40;
  let n = 0;

  for (const sec of guia.secciones) {
    // La sección no empieza en el pie de página: título + consejo + 2 frases como mínimo
    if (doc.y + 140 > bottom()) doc.addPage();

    doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(sec.titulo, L, doc.y, { width: CW });
    doc.moveTo(L, doc.y + 3).lineTo(L + 40, doc.y + 3).lineWidth(2).strokeColor(ORANGE).stroke();
    doc.moveDown(0.6);

    doc.font("Helvetica").fontSize(9.5);
    const hTip = doc.heightOfString(sec.consejo, { width: CW - 90 }) + 16;

    sec.frases.forEach((f, i) => {
      n += 1;
      doc.font("Helvetica-Bold").fontSize(11);
      const hDe = doc.heightOfString(f.de, { width: colDe });
      doc.font("Helvetica").fontSize(10);
      const hEs = doc.heightOfString(f.es, { width: colEs });
      const h = Math.max(hDe, hEs) + 12;
      // La última frase baja de página junto con el consejo: nunca queda suelto
      const need = i === sec.frases.length - 1 ? h + hTip + 4 : h;
      if (doc.y + need > bottom()) doc.addPage();
      const y = doc.y;

      doc.circle(L + 10, y + 7, 10).fill(CREAM);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ORANGE)
        .text(String(n), L, y + 2.5, { width: 20, align: "center" });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY)
        .text(f.de, L + 30, y + 1, { width: colDe });
      doc.font("Helvetica").fontSize(10).fillColor(GRAY)
        .text(f.es, L + 40 + colDe, y + 1.5, { width: colEs });
      doc.moveTo(L + 30, y + h - 4).lineTo(L + CW, y + h - 4).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    });

    // Consejo
    const ty = doc.y + 4;
    doc.roundedRect(L, ty, CW, hTip, 6).fill(CREAM);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(ORANGE).text("Consejo", L + 12, ty + 8);
    doc.font("Helvetica").fontSize(9.5).fillColor(NAVY).text(sec.consejo, L + 78, ty + 8, { width: CW - 90 });
    doc.y = ty + hTip + 18;
  }

  // Cierre
  const cierre = "Practica estas frases en tus clases: tu profesor te corregirá la pronunciación y te ayudará a usarlas con naturalidad.";
  doc.font("Helvetica").fontSize(10);
  if (doc.y + doc.heightOfString(cierre, { width: CW }) + 10 > bottom()) doc.addPage();
  doc.font("Helvetica-Oblique").fontSize(10).fillColor(GRAY).text(cierre, L, doc.y, { width: CW, lineGap: 2 });

  // Pie en todas las páginas
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Sin margen inferior: si no, pdfkit abre una página nueva al escribir el pie
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    doc.moveTo(L, fy - 8).lineTo(L + CW, fy - 8).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(LGRAY)
      .text(`Aprender-Aleman.de  ·  Tus primeras 30 frases en alemán  ·  ${nivel}`, L, fy, { width: CW - 60, lineBreak: false });
    doc.text(`${i - range.start + 1} / ${range.count}`, L + CW - 60, fy, { width: 60, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
