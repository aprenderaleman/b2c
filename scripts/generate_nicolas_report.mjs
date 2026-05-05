import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer,
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };

const headerFill = "1F4E79";
const stripeFill = "F2F2F2";

function tableHeaderCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: headerFill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
    })],
  });
}

function tableCell(text, width, opts = {}) {
  const { fill, bold = false, align = AlignmentType.LEFT, color } = opts;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, size: 20, color })],
    })],
  });
}

const cols = [800, 1700, 1200, 4360, 1300]; // sum = 9360
const total = cols.reduce((a,b)=>a+b, 0);

// ── DATA ───────────────────────────────────────────────────────────────
// Solo las clases reales que Nicolás tuvo disponibles. Excluidas:
// 5 sesiones de "TESTING/on_demand" del 2026-04-20 (clicks de prueba, 1-7 min)
// 1 cancelled-placeholder del 2026-04-20 07:00 (reemplazado por la real 07:12)
// 2 "scheduled" duplicados (04-22 y 04-27) que doblan la sesión real del mismo día
//
// Convención: 1 clase = 1 hora (50 min). Sesiones de ~100-120 min = 2 clases.

const morgens = [
  { fecha: "2026-03-30", dia: "Lunes",     hora: "09:25", min: 122, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-01", dia: "Miércoles", hora: "08:56", min: 122, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-08", dia: "Miércoles", hora: "08:57", min: 117, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-13", dia: "Lunes",     hora: "09:12", min: 115, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-15", dia: "Miércoles", hora: "08:57", min: 114, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-20", dia: "Lunes",     hora: "09:12", min: 131, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-22", dia: "Miércoles", hora: "08:57", min: 120, clases: 2, asist: "Asistió" },
  { fecha: "2026-04-27", dia: "Lunes",     hora: "09:15", min: 120, clases: 2, asist: "No asistió" },
  { fecha: "2026-04-29", dia: "Miércoles", hora: "09:00", min: 120, clases: 2, asist: "No asistió" },
  { fecha: "2026-05-04", dia: "Lunes",     hora: "09:00", min: 120, clases: 2, asist: "Asistió" },
];

const nachmittags = [
  { fecha: "2026-02-10", dia: "Martes", hora: "17:57", min: 130, clases: 2, asist: "Asistió" },
  { fecha: "2026-02-12", dia: "Jueves", hora: "18:00", min: 124, clases: 2, asist: "Asistió" },
  { fecha: "2026-02-17", dia: "Martes", hora: "18:00", min: 125, clases: 2, asist: "Asistió" },
  { fecha: "2026-02-19", dia: "Jueves", hora: "18:01", min: 120, clases: 2, asist: "Asistió" },
  { fecha: "2026-02-24", dia: "Martes", hora: "18:02", min: 120, clases: 2, asist: "Asistió" },
  { fecha: "2026-02-26", dia: "Jueves", hora: "18:01", min: 122, clases: 2, asist: "Asistió" },
  { fecha: "2026-03-03", dia: "Martes", hora: "18:02", min: 120, clases: 2, asist: "Asistió" },
  { fecha: "2026-03-05", dia: "Jueves", hora: "18:01", min: 125, clases: 2, asist: "Asistió" },
];

const futuras = [
  { fecha: "2026-05-06", dia: "Miércoles", hora: "09:00" },
  { fecha: "2026-05-11", dia: "Lunes",     hora: "09:00" },
  { fecha: "2026-05-13", dia: "Miércoles", hora: "09:00" },
  { fecha: "2026-05-18", dia: "Lunes",     hora: "09:00" },
  { fecha: "2026-05-20", dia: "Miércoles", hora: "09:00" },
  { fecha: "2026-05-25", dia: "Lunes",     hora: "09:00" },
  { fecha: "2026-06-01", dia: "Lunes",     hora: "09:00" },
  { fecha: "2026-06-03", dia: "Miércoles", hora: "09:00" },
  { fecha: "2026-06-08", dia: "Lunes",     hora: "09:00" },
  { fecha: "2026-06-10", dia: "Miércoles", hora: "09:00" },
];

const totalMorgens     = morgens.reduce((s, c) => s + c.clases, 0);
const totalNachmittags = nachmittags.reduce((s, c) => s + c.clases, 0);
const totalGeneral     = totalMorgens + totalNachmittags;
const totalFuturas     = futuras.length * 2;

// Plan / contrato
const PLAN_TOTAL    = 48;          // clases en total
const PLAN_MESES    = 3;
const PLAN_POR_MES  = 16;
const PLAN_POR_SEM  = 4;
const consumidas    = totalGeneral;          // 36
const restantes     = PLAN_TOTAL - consumidas;  // 12
const sesionesRest  = Math.ceil(restantes / 2); // 6 sesiones de 2h

// ── BUILDERS ───────────────────────────────────────────────────────────
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

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 140 },
    children: [new TextRun({ text, bold: true, size: 26, color: "1F4E79" })],
  });
}

function buildTable(rows, opts = {}) {
  const { showAttendance = true } = opts;
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      tableHeaderCell("#", cols[0]),
      tableHeaderCell("Fecha", cols[1]),
      tableHeaderCell("Día", cols[2]),
      tableHeaderCell("Hora (Berlín)", cols[3]),
      tableHeaderCell(showAttendance ? "Clases / Asistencia" : "Duración (clases)", cols[4]),
    ],
  });
  const dataRows = rows.map((r, i) => {
    const stripe = i % 2 === 1 ? stripeFill : undefined;
    return new TableRow({
      children: [
        tableCell(String(i + 1), cols[0], { fill: stripe, align: AlignmentType.CENTER, bold: true }),
        tableCell(r.fecha, cols[1], { fill: stripe }),
        tableCell(r.dia, cols[2], { fill: stripe }),
        tableCell(r.hora + (r.min ? `  ·  ${r.min} min` : ""), cols[3], { fill: stripe }),
        tableCell(
          showAttendance
            ? `${r.clases} clase${r.clases > 1 ? "s" : ""}  ·  ${r.asist}`
            : "2 clases",
          cols[4],
          {
            fill: stripe,
            align: AlignmentType.CENTER,
            color: r.asist === "No asistió" ? "C00000" : undefined,
          },
        ),
      ],
    });
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: cols,
    rows: [headerRow, ...dataRows],
  });
}

// Summary table (2 cols)
function summaryTable() {
  const w1 = 6000, w2 = 3360;
  const row = (k, v, opts = {}) => new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: w1, type: WidthType.DXA },
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: k, bold: opts.bold, size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: w2, type: WidthType.DXA },
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: v, bold: opts.bold, size: 22, color: opts.color })],
        })],
      }),
    ],
  });
  const asistio = morgens.filter(c => c.asist === "Asistió").reduce((s,c)=>s+c.clases,0)
                + nachmittags.reduce((s,c)=>s+c.clases,0);
  const noFue = morgens.filter(c => c.asist === "No asistió").reduce((s,c)=>s+c.clases,0);
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [w1, w2],
    rows: [
      row("Grupo Nachmittags con Martin · sesiones (mar/jue, feb–mar)", `${nachmittags.length}`),
      row("Grupo Nachmittags con Martin · total clases", `${totalNachmittags}`),
      row("Grupo Morgens con Sabine · sesiones (lun/mié, desde 30.03)", `${morgens.length}`),
      row("Grupo Morgens con Sabine · total clases", `${totalMorgens}`),
      row("TOTAL clases recibidas hasta el 5 de mayo de 2026", `${totalGeneral}`, { bold: true, fill: "DEEBF7" }),
      row("De las cuales: asistió", `${asistio}`, { color: "1F7A1F" }),
      row("De las cuales: no asistió", `${noFue}`, { color: "C00000" }),
    ],
  });
}

function planTable() {
  const w1 = 6000, w2 = 3360;
  const row = (k, v, opts = {}) => new TableRow({
    children: [
      new TableCell({ borders, width: { size: w1, type: WidthType.DXA },
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: k, bold: opts.bold, size: 22 })] })] }),
      new TableCell({ borders, width: { size: w2, type: WidthType.DXA },
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        children: [new Paragraph({ alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: v, bold: opts.bold, size: 22, color: opts.color })] })] }),
    ],
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [w1, w2],
    rows: [
      row("Duración del plan", `${PLAN_MESES} meses`),
      row("Clases por semana", `${PLAN_POR_SEM}`),
      row("Clases por mes", `${PLAN_POR_MES}`),
      row("Total de clases del plan", `${PLAN_TOTAL}`, { bold: true, fill: "DEEBF7" }),
      row("Clases consumidas hasta hoy (5 de mayo)", `${consumidas}`, { color: "1F7A1F" }),
      row("Clases restantes del plan", `${restantes}`, { bold: true, color: "C00000", fill: "FFF4E6" }),
      row("Equivalente en sesiones (≈ 2h cada una)", `${sesionesRest} sesiones`),
    ],
  });
}

// ── DOCUMENT ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: "Aprender-Aleman.de",
  title: "Reporte de clases — Nicolas Abellan",
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F4E79" },
        paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "1F4E79" },
        paragraph: { spacing: { before: 200, after: 140 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "Aprender-Aleman.de", size: 18, color: "808080", italics: true })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Página ", size: 18, color: "808080" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" }),
            new TextRun({ text: " · Reporte generado el 5 de mayo de 2026", size: 18, color: "808080" }),
          ],
        })],
      }),
    },
    children: [
      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: "Reporte de clases recibidas", bold: true, size: 40, color: "1F4E79" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: "Nicolas Abellan", bold: true, size: 32, color: "404040" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320 },
        children: [new TextRun({ text: "Nivel A1  ·  carraasco.nico18@gmail.com", size: 20, color: "808080" })],
      }),

      // Intro
      p(
        "Hola Nicolas,",
        { spacingAfter: 160 },
      ),
      p(
        "Aquí tienes el detalle corregido de las clases que has tenido en la plataforma. Tu plan contratado es de 3 meses con 48 clases en total (16 al mes · 4 a la semana). En esta convención, 1 clase = 1 hora (50 min efectivos), por lo que cada sesión grupal de ~2 horas equivale a 2 clases.",
        { spacingAfter: 160 },
      ),
      p(
        "Profesores: Martin (Nachmittags · feb–mar) y Sabine Arning (Morgens · desde el 30.03).",
        { bold: true, spacingAfter: 160 },
      ),
      p(
        "Aviso: una versión anterior incluía 13 sesiones del grupo Morgens entre el 8 de febrero y el 18 de marzo que NO te correspondían — fueron añadidas por error a tu cuenta cuando te incorporaste al grupo el 19 de abril (importación masiva de las grabaciones del grupo). Ya están descartadas en este reporte.",
        { spacingAfter: 240 },
      ),

      // Plan
      h1("Tu plan contratado"),
      p("Plan de 3 meses con un total de 48 clases (16 clases al mes · 4 clases a la semana).", { spacingAfter: 160 }),
      planTable(),

      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("")] }),

      // Summary
      h1("Resumen de clases recibidas"),
      summaryTable(),

      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("")] }),

      // Nachmittags (Martin) — primero porque fue antes en el tiempo
      h1("Grupo · Deutsch A1.2 Nachmittags (archivado) — con Martin"),
      p("Sesiones de martes y jueves por la tarde, del 10 de febrero al 5 de marzo de 2026. Profesor: Martin (este grupo fue archivado al cerrarse).", { spacingAfter: 160 }),
      buildTable(nachmittags),

      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("")] }),

      // Morgens (Sabine)
      h1("Grupo · Deutsch A1 – B1 Morgens — con Sabine"),
      p("Sesiones de lunes y miércoles por la mañana. Profesora: Sabine Arning. Te incorporaste a este grupo el 30 de marzo de 2026.", { spacingAfter: 160 }),
      buildTable(morgens),

      new Paragraph({ spacing: { before: 200 }, children: [new TextRun("")] }),

      // Futuras
      h1("Próximas clases programadas"),
      p(`Tienes ${futuras.length} sesiones agendadas en tu calendario hasta el 10 de junio. Cada sesión consume 2 clases del plan, así que las primeras ${sesionesRest} sesiones agotan las ${restantes} clases que te quedan; el resto quedaría fuera del plan actual.`, { spacingAfter: 160 }),
      buildTable(futuras, { showAttendance: false }),

      new Paragraph({ spacing: { before: 240 }, children: [new TextRun("")] }),

      // Notes
      h2("Notas"),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 100 },
        children: [new TextRun({ text: "Las horas mostradas están en zona horaria de Berlín (CET / CEST).", size: 22 })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 100 },
        children: [new TextRun({ text: "Una clase equivale a 1 hora (50 minutos efectivos). Una sesión grupal de 100 minutos cuenta como 2 clases.", size: 22 })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 100 },
        children: [new TextRun({ text: "Si detectas algún error en el listado, escríbenos por WhatsApp y lo revisamos juntos.", size: 22 })],
      }),

      new Paragraph({ spacing: { before: 320 }, children: [new TextRun("")] }),

      p("Un saludo,", { spacingAfter: 80 }),
      p("Equipo de Aprender-Aleman.de", { bold: true }),
    ],
  }],
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
});

const out = "C:/Users/gelfi/Desktop/b2c/Reporte_Nicolas_Abellan.docx";
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(out, buffer);
console.log(`✔ Generado: ${out}`);
console.log(`  Total clases recibidas: ${totalGeneral}`);
console.log(`  Sesiones Morgens: ${morgens.length} (${totalMorgens} clases)`);
console.log(`  Sesiones Nachmittags: ${nachmittags.length} (${totalNachmittags} clases)`);
console.log(`  Futuras: ${futuras.length} sesiones (${totalFuturas} clases)`);
