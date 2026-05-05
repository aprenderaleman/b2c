import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer,
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const headerFill = "1F4E79";
const stripeFill = "F2F2F2";
const totalFill  = "DEEBF7";
const adjFill    = "FFF4E6";

function tCell(text, w, opts = {}) {
  const { fill, bold = false, align = AlignmentType.LEFT, color, header = false } = opts;
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold: header || bold, color: header ? "FFFFFF" : color, size: 20 })],
    })],
  });
}

function p(text, opts = {}) {
  const { bold = false, size = 22, align = AlignmentType.LEFT, color, spacingAfter = 120 } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter },
    children: [new TextRun({ text, bold, size, color })],
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 180 },
    children: [new TextRun({ text, bold: true, size: 32, color: "1F4E79" })],
  });
}

// ── DATOS ───────────────────────────────────────────────────────────
// Marzo 2026 — 14 clases registradas en BD + 1 ajuste de 30€
const marzo = [
  { fecha: "2026-03-02", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-03", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-09", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-10", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-12", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-13", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-16", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-17", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-19", concepto: "Gruppe A1 (2 horas)",         horas: 2, tarifa: 17, total: 34 },
  { fecha: "2026-03-23", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-23", concepto: "Gruppe A1 (2 horas)",         horas: 2, tarifa: 17, total: 34 },
  { fecha: "2026-03-24", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-26", concepto: "Fernanda B1",                 horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-03-26", concepto: "Gruppe A1 (1 hora)",          horas: 1, tarifa: 17, total: 17 },
  { fecha: "—",          concepto: "Ajuste manual (Florian apuntó 280€)", horas: 0, tarifa: 0, total: 30, isAdj: true },
];

// Abril 2026
const abril = [
  { fecha: "2026-04-09", concepto: "Gruppe A1 (2 horas)",                            horas: 2, tarifa: 17, total: 34 },
  { fecha: "2026-04-10", concepto: "Fernanda B1",                                    horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-04-13", concepto: "Gruppe A1 — no asistieron alumnos (2 horas)",   horas: 2, tarifa: 17, total: 34, isNoShow: true },
  { fecha: "2026-04-16", concepto: "Gruppe A1 (1 hora)",                             horas: 1, tarifa: 17, total: 17 },
  { fecha: "2026-04-20", concepto: "Fernanda B1",                                    horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-04-20", concepto: "Gruppe A1 (1 hora)",                             horas: 1, tarifa: 17, total: 17 },
  { fecha: "2026-04-21", concepto: "Fernanda B1",                                    horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-04-23", concepto: "Gruppe A1 — no asistieron alumnos (2 horas)",   horas: 2, tarifa: 17, total: 34, isNoShow: true },
  { fecha: "2026-04-28", concepto: "Fernanda B1",                                    horas: 1, tarifa: 15, total: 15 },
  { fecha: "2026-04-30", concepto: "Gruppe A1 (1 hora)",                             horas: 1, tarifa: 17, total: 17 },
];

const totalMar = marzo.reduce((s,r)=>s+r.total,0);
const totalAbr = abril.reduce((s,r)=>s+r.total,0);
const totalGen = totalMar + totalAbr;
const yaPagado = 113 + 250 + 90; // ene-feb-mar pagados (90 ene, 250 mar antes del ajuste, 113 abr antes)
                                   // pero realmente era: feb=90, mar=250, abr=113 = 453€ pagados
const realmentePagado = 90 + 250 + 113; // 453€
const totalDebido      = 90 + 280 + 213; // feb 90 (sin cambios) + mar 280 + abr 213 = 583€
const diferencia       = totalDebido - realmentePagado; // 130€

// ── BUILDERS ────────────────────────────────────────────────────────
const cols = [1700, 4660, 1000, 1000, 1000];
const sumCols = cols.reduce((a,b)=>a+b,0);

function buildTable(rows, totalLabel, total) {
  const head = new TableRow({ tableHeader: true, children: [
    tCell("Fecha", cols[0], { fill: headerFill, header: true }),
    tCell("Concepto", cols[1], { fill: headerFill, header: true }),
    tCell("Horas", cols[2], { fill: headerFill, header: true, align: AlignmentType.CENTER }),
    tCell("€/h", cols[3], { fill: headerFill, header: true, align: AlignmentType.CENTER }),
    tCell("Total", cols[4], { fill: headerFill, header: true, align: AlignmentType.RIGHT }),
  ]});
  const dataRows = rows.map((r, i) => {
    const stripe = i % 2 === 1 ? stripeFill : undefined;
    const fill = r.isNoShow ? "FFF4E6" : (r.isAdj ? "E8F1F8" : stripe);
    return new TableRow({ children: [
      tCell(r.fecha, cols[0], { fill }),
      tCell(r.concepto, cols[1], { fill, color: r.isNoShow ? "C00000" : undefined }),
      tCell(r.horas ? String(r.horas) : "—", cols[2], { fill, align: AlignmentType.CENTER }),
      tCell(r.tarifa ? `${r.tarifa}€` : "—", cols[3], { fill, align: AlignmentType.CENTER }),
      tCell(`${r.total}€`, cols[4], { fill, align: AlignmentType.RIGHT, bold: true }),
    ]});
  });
  const totalRow = new TableRow({ children: [
    tCell(totalLabel, cols[0]+cols[1]+cols[2]+cols[3], { fill: totalFill, bold: true, align: AlignmentType.RIGHT }),
    tCell("", cols[1], { fill: totalFill }),  // placeholder — se ignora porque arriba ya combinamos
    tCell("", cols[2], { fill: totalFill }),
    tCell("", cols[3], { fill: totalFill }),
    tCell(`${total}€`, cols[4], { fill: totalFill, bold: true, align: AlignmentType.RIGHT }),
  ]});
  // El total mejor con sólo 2 celdas: una grande de etiqueta + una de número
  const totalRowSimple = new TableRow({ children: [
    new TableCell({
      borders,
      width: { size: cols[0]+cols[1]+cols[2]+cols[3], type: WidthType.DXA },
      shading: { fill: totalFill, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      columnSpan: 4,
      children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: totalLabel, bold: true, size: 22 })] })],
    }),
    new TableCell({
      borders,
      width: { size: cols[4], type: WidthType.DXA },
      shading: { fill: totalFill, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 120, right: 120 },
      children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `${total}€`, bold: true, size: 24, color: "1F4E79" })] })],
    }),
  ]});
  return new Table({
    width: { size: sumCols, type: WidthType.DXA },
    columnWidths: cols,
    rows: [head, ...dataRows, totalRowSimple],
  });
}

function summaryTable() {
  const w1=6500, w2=2860;
  const row = (k, v, opts={}) => new TableRow({ children: [
    new TableCell({ borders, width: { size: w1, type: WidthType.DXA },
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 140, right: 140 },
      children: [new Paragraph({ children: [new TextRun({ text: k, bold: opts.bold, size: 22 })] })] }),
    new TableCell({ borders, width: { size: w2, type: WidthType.DXA },
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 140, right: 140 },
      children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: v, bold: opts.bold, size: 22, color: opts.color })] })] }),
  ]});
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [w1, w2],
    rows: [
      row("Febrero 2026 (sin cambios)",                            "90€"),
      row("Marzo 2026 (corregido: 250€ → 280€, +30€)",             "280€"),
      row("Abril 2026 (corregido: 113€ → 213€, +100€)",            "213€"),
      row("TOTAL febrero–abril 2026",                              `${90+280+213}€`, { bold: true, fill: totalFill }),
      row("Ya pagado",                                             `${realmentePagado}€`),
      row("Diferencia pendiente de pago",                          `${diferencia}€`, { bold: true, color: "C00000", fill: adjFill }),
    ],
  });
}

const doc = new Document({
  creator: "Aprender-Aleman.de",
  title: "Reporte de horas — Florian Zormann (feb–abr 2026)",
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F4E79" },
        paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 0 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "Aprender-Aleman.de · Reporte de horas docentes", size: 18, color: "808080", italics: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Página ", size: 18, color: "808080" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" }),
        new TextRun({ text: " · Generado el 5 de mayo de 2026", size: 18, color: "808080" }),
      ] })] }) },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
        children: [new TextRun({ text: "Reporte de horas docentes", bold: true, size: 40, color: "1F4E79" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
        children: [new TextRun({ text: "Florian Zormann", bold: true, size: 32, color: "404040" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 },
        children: [new TextRun({ text: "Período: marzo–abril 2026", size: 22, color: "808080" })] }),

      p("Hola Florian,", { spacingAfter: 160 }),
      p("Tienes razón con tu cálculo. He revisado clase por clase y confirmamos que faltaban 100€ en abril y 30€ en marzo. Aquí tienes el detalle completo y corregido. La diferencia (130€) se ingresará en tu próxima transferencia.", { spacingAfter: 240 }),

      h1("Resumen general"),
      summaryTable(),

      new Paragraph({ spacing: { before: 240 }, children: [new TextRun("")] }),

      h1("Marzo 2026"),
      p("Tarifas: Gruppe A1 = 17€/hora · Fernanda B1 = 15€/hora.", { spacingAfter: 160 }),
      buildTable(marzo, "TOTAL marzo", totalMar),

      new Paragraph({ spacing: { before: 240 }, children: [new TextRun("")] }),

      h1("Abril 2026"),
      p("Tarifas: Gruppe A1 = 17€/hora · Fernanda B1 = 15€/hora. Las celdas en naranja son clases donde no asistió ningún alumno; se te abona igualmente porque estuviste disponible.", { spacingAfter: 160 }),
      buildTable(abril, "TOTAL abril", totalAbr),

      new Paragraph({ spacing: { before: 320 }, children: [new TextRun("")] }),

      h1("Causas de los faltantes detectados"),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 100 },
        children: [new TextRun({ text: "13 de abril (lunes) — Gruppe A1 (no asistieron): la clase no se había registrado en el sistema porque no hubo grabación. Ya creada con 2h × 17€ = 34€.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 100 },
        children: [new TextRun({ text: "23 de abril (jueves) — Gruppe A1 (no asistieron): estaba como “programada” en el sistema pero nunca pasó a “completada”. Corregida a completada con 2h × 17€ = 34€.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 100 },
        children: [new TextRun({ text: "28 de abril — Fernanda B1: la clase estaba registrada pero el sistema no le había puesto el tiempo facturable. Corregida a 1h × 15€ = 15€.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 100 },
        children: [new TextRun({ text: "30 de abril — Gruppe A1 (1 hora): mismo bug que la del 28; corregida a 1h × 17€ = 17€.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 100 },
        children: [new TextRun({ text: "Marzo: ajuste de +30€ aceptado según tu cálculo (280€ en lugar de 250€).", size: 22 })] }),

      new Paragraph({ spacing: { before: 320 }, children: [new TextRun("")] }),
      p("Gracias por avisarnos — esta revisión nos ayuda a tener los registros bien.", { spacingAfter: 100 }),
      p("Un saludo,", { spacingAfter: 80 }),
      p("Gelfis Horn", { bold: true }),
    ],
  }],
  numbering: {
    config: [{ reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
  },
});

const out = "C:/Users/gelfi/Desktop/b2c/Reporte_Horas_Florian.docx";
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(out, buffer);
console.log(`✔ Generado: ${out}`);
console.log(`  Mar: ${totalMar}€ | Abr: ${totalAbr}€ | Total feb–abr: ${90+280+213}€ | Pendiente: ${diferencia}€`);
