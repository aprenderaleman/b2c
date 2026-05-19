// Genera 14 PDFs (presentación profesor) + 14 Words (cuaderno alumno)
// a partir de scripts/materiales/lecciones.mjs.
//
// PDFs: A4 landscape, fuentes grandes, una sección por página
//       (cover, objetivos, vocab, gramática, ejemplos, ejercicio en clase,
//        resumen, despedida).
//
// Words: A4 portrait, layout cuaderno con líneas para escribir,
//        secciones idénticas a las del PDF + 5 ejercicios al final.
//
// Output: materiales/<NIVEL>/<NIVEL>-leccion-<N>-<slug>.{docx,pdf}
//
// Tras generar los .docx, los convierto a .pdf via Word COM en una
// segunda fase (PowerShell). Aquí solo produzco los DOCX.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LECCIONES } from "./lecciones.mjs";

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer, PageBreak,
} = require("docx");

// ── Colores y estilos ──────────────────────────────────────────
const BRAND_DARK  = "1F4E79";
const BRAND_LIGHT = "DEEBF7";
const TEXT_DARK   = "1A1A1A";
const STRIPE      = "F4F6F9";
const ACCENT      = "C75B12";

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };

const ROOT = "C:/Users/gelfi/Desktop/b2c/materiales";

// ── Helpers ────────────────────────────────────────────────────
function p(text, opts = {}) {
  const { bold = false, size = 24, align = AlignmentType.LEFT, color, spacingAfter = 120, italics = false } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter },
    children: [new TextRun({ text, bold, size, color, italics })],
  });
}

function h(text, level = 1, color = BRAND_DARK) {
  const sizes = { 1: 48, 2: 36, 3: 28 };
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 200 },
    children: [new TextRun({ text, bold: true, size: sizes[level], color })],
  });
}

function tableCell(text, w, opts = {}) {
  const { fill, bold = false, align = AlignmentType.LEFT, color, header = false, size = 22 } = opts;
  return new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold: header || bold, color: header ? "FFFFFF" : color, size })],
    })],
  });
}

function blankLine(spacingAfter = 120) {
  return new Paragraph({ spacing: { after: spacingAfter }, children: [new TextRun("")] });
}

// ── PDF/presentation builder (landscape A4, big fonts) ─────────
function buildPdfDoc(L) {
  const sections = [];

  const pageMeta = {
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 720, right: 1080, bottom: 720, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: `${L.level} · Lektion ${L.n}`, size: 18, color: "888888", italics: true })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Aprender-Aleman.de · ", size: 18, color: "888888" }),
            new TextRun({ text: "Seite ", size: 18, color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
          ],
        })],
      }),
    },
    children: [],
  };

  // ── Folie 1 — Deckblatt ──
  pageMeta.children.push(
    new Paragraph({
      spacing: { before: 1400, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Niveau ${L.level}`, size: 56, color: ACCENT, bold: true })],
    }),
    new Paragraph({
      spacing: { after: 600 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Lektion ${L.n}`, size: 32, color: "888888" })],
    }),
    new Paragraph({
      spacing: { after: 800 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: L.title, size: 72, bold: true, color: BRAND_DARK })],
    }),
    new Paragraph({
      spacing: { before: 1600 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Aprender-Aleman.de", size: 24, italics: true, color: "888888" })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Folie 2 — Lernziele ──
  pageMeta.children.push(
    h("Lernziele", 1, ACCENT),
    blankLine(200),
  );
  for (let i = 0; i < L.learningObjectives.length; i++) {
    pageMeta.children.push(new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: `${i + 1}.  `, bold: true, size: 32, color: ACCENT }),
        new TextRun({ text: L.learningObjectives[i], size: 30, color: TEXT_DARK }),
      ],
    }));
  }
  pageMeta.children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Folie 3 — Wortschatz ──
  pageMeta.children.push(h("Wortschatz", 1, ACCENT), blankLine(120));
  const colDe = 5500, colEs = 5500;
  const vocabRows = [
    new TableRow({ tableHeader: true, children: [
      tableCell("Deutsch", colDe, { fill: BRAND_DARK, header: true, size: 24 }),
      tableCell("Spanisch", colEs, { fill: BRAND_DARK, header: true, size: 24 }),
    ]}),
    ...L.vocabulary.map((v, i) => new TableRow({
      children: [
        tableCell(v.de, colDe, { fill: i % 2 ? STRIPE : undefined, size: 24, bold: true }),
        tableCell(v.es, colEs, { fill: i % 2 ? STRIPE : undefined, size: 24, color: "555555" }),
      ],
    })),
  ];
  pageMeta.children.push(new Table({
    width: { size: colDe + colEs, type: WidthType.DXA },
    columnWidths: [colDe, colEs],
    rows: vocabRows,
  }));
  pageMeta.children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Folie 4 — Grammatik ──
  pageMeta.children.push(
    h("Grammatik", 1, ACCENT),
    p(L.grammar.title, { bold: true, size: 30, color: BRAND_DARK, spacingAfter: 200 }),
    p(L.grammar.explanation, { size: 24, color: TEXT_DARK, spacingAfter: 320 }),
  );
  pageMeta.children.push(p("Beispiele:", { bold: true, size: 26, color: BRAND_DARK, spacingAfter: 160 }));
  for (const ex of L.grammar.examples) {
    pageMeta.children.push(new Paragraph({
      spacing: { after: 140 },
      children: [
        new TextRun({ text: "›  ", bold: true, size: 24, color: ACCENT }),
        new TextRun({ text: ex, size: 24, color: TEXT_DARK }),
      ],
    }));
  }
  pageMeta.children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Folie 5 — Beispiele (real-life examples) ──
  pageMeta.children.push(
    h("Beispiele aus dem Alltag", 1, ACCENT),
    blankLine(160),
  );
  for (const ex of L.examples) {
    pageMeta.children.push(new Paragraph({
      spacing: { after: 280 },
      children: [
        new TextRun({ text: "▸  ", bold: true, size: 28, color: ACCENT }),
        new TextRun({ text: ex, size: 28, color: TEXT_DARK }),
      ],
    }));
  }
  pageMeta.children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Folie 6 — Übung im Unterricht ──
  pageMeta.children.push(
    h("Übung im Unterricht", 1, ACCENT),
    blankLine(160),
    p(L.classExercise, { size: 28, color: TEXT_DARK, spacingAfter: 200 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Folie 7 — Hausaufgabe ──
  pageMeta.children.push(
    h("Hausaufgabe", 1, ACCENT),
    blankLine(160),
    p(L.homework, { size: 28, color: TEXT_DARK, spacingAfter: 200 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Folie 8 — Zusammenfassung ──
  pageMeta.children.push(
    h("Zusammenfassung", 1, ACCENT),
    blankLine(160),
    p(L.summary, { size: 32, color: TEXT_DARK, italics: true, spacingAfter: 200 }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Folie 9 — Abschluss ──
  pageMeta.children.push(
    new Paragraph({ spacing: { before: 1800 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Vielen Dank!", size: 80, bold: true, color: BRAND_DARK })] }),
    new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Bis zur nächsten Stunde 👋", size: 36, color: "888888" })] }),
  );

  sections.push(pageMeta);

  return new Document({
    creator: "Aprender-Aleman.de",
    title: `${L.level} · Lektion ${L.n} · ${L.title}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 24 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 48, bold: true, font: "Calibri", color: BRAND_DARK },
          paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Calibri", color: BRAND_DARK },
          paragraph: { spacing: { before: 220, after: 160 }, outlineLevel: 1 } },
      ],
    },
    sections,
  });
}

// ── Word workbook (portrait A4) ────────────────────────────────
function buildWorkbookDoc(L) {
  const children = [];

  // Cover
  children.push(
    new Paragraph({
      spacing: { before: 600, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Niveau ${L.level} — Lektion ${L.n}`, size: 28, color: ACCENT, bold: true })],
    }),
    new Paragraph({
      spacing: { after: 400 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: L.title, size: 44, bold: true, color: BRAND_DARK })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Übungsheft — Aprender-Aleman.de", size: 20, italics: true, color: "888888" })],
    }),
    blankLine(400),
  );

  // Name / Datum lines
  const nameTblW = 9360;
  children.push(new Table({
    width: { size: nameTblW, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [new TableRow({ children: [
      tableCell("Name: _________________________________________", 4680, { size: 22, bold: false }),
      tableCell("Datum: ______________________________", 4680, { size: 22, bold: false }),
    ]})],
  }));
  children.push(blankLine(400));

  // Lernziele
  children.push(h("Lernziele dieser Lektion", 2, BRAND_DARK));
  for (const obj of L.learningObjectives) {
    children.push(new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 100 },
      children: [new TextRun({ text: obj, size: 22 })],
    }));
  }
  children.push(blankLine(200));

  // Wortschatz table
  children.push(h("Wortschatz", 2, BRAND_DARK));
  const wColDe = 3200, wColEs = 3200, wColNotes = 2960;
  const wRows = [
    new TableRow({ tableHeader: true, children: [
      tableCell("Deutsch", wColDe, { fill: BRAND_DARK, header: true }),
      tableCell("Spanisch", wColEs, { fill: BRAND_DARK, header: true }),
      tableCell("Notizen", wColNotes, { fill: BRAND_DARK, header: true }),
    ]}),
    ...L.vocabulary.map((v, i) => new TableRow({
      children: [
        tableCell(v.de, wColDe, { fill: i % 2 ? STRIPE : undefined, bold: true }),
        tableCell(v.es, wColEs, { fill: i % 2 ? STRIPE : undefined, color: "555555" }),
        tableCell("", wColNotes, { fill: i % 2 ? STRIPE : undefined }),
      ],
    })),
  ];
  children.push(new Table({
    width: { size: wColDe + wColEs + wColNotes, type: WidthType.DXA },
    columnWidths: [wColDe, wColEs, wColNotes],
    rows: wRows,
  }));
  children.push(blankLine(300));

  // Grammar notes
  children.push(h("Grammatik-Notizen", 2, BRAND_DARK));
  children.push(p(L.grammar.title, { bold: true, size: 24, color: BRAND_DARK, spacingAfter: 160 }));
  children.push(p(L.grammar.explanation, { size: 22, spacingAfter: 200 }));
  children.push(p("Beispiele:", { bold: true, size: 22, spacingAfter: 80 }));
  for (const ex of L.grammar.examples) {
    children.push(new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 80 },
      children: [new TextRun({ text: ex, size: 22 })],
    }));
  }
  children.push(blankLine(300));

  // Mis notas (espacio en blanco con líneas)
  children.push(h("Meine Notizen", 2, BRAND_DARK));
  for (let i = 0; i < 6; i++) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 6 } },
      children: [new TextRun({ text: " ", size: 22 })],
    }));
  }
  children.push(blankLine(200));

  // Ejercicios
  children.push(h("Übungen", 2, BRAND_DARK));
  for (const ex of L.workbookExercises) {
    children.push(p(ex.title, { bold: true, size: 24, color: BRAND_DARK, spacingAfter: 100 }));
    children.push(p(ex.instruction, { italics: true, size: 22, color: "555555", spacingAfter: 160 }));
    // Render content preserving newlines
    const lines = String(ex.content).split("\n");
    for (const line of lines) {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: line, size: 22, font: "Consolas" })],
      }));
    }
    children.push(blankLine(240));
  }

  // Hausaufgabe
  children.push(h("Hausaufgabe", 2, BRAND_DARK));
  children.push(p(L.homework, { size: 22, spacingAfter: 240 }));
  // Espacio para escribir la tarea
  for (let i = 0; i < 8; i++) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 6 } },
      children: [new TextRun({ text: " ", size: 22 })],
    }));
  }

  return new Document({
    creator: "Aprender-Aleman.de",
    title: `Übungsheft ${L.level} Lektion ${L.n} — ${L.title}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, font: "Calibri", color: BRAND_DARK },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `${L.level} · Übungsheft Lektion ${L.n}`, size: 16, color: "888888", italics: true })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Aprender-Aleman.de · Seite ", size: 16, color: "888888" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

// ── Main: genera los 28 archivos ────────────────────────────────
for (const L of LECCIONES) {
  const dir = path.join(ROOT, L.level);
  fs.mkdirSync(dir, { recursive: true });

  // PDF (DOCX que luego convertimos a PDF)
  const pdfDoc = buildPdfDoc(L);
  const pdfBuf = await Packer.toBuffer(pdfDoc);
  const pdfDocxPath = path.join(dir, `${L.level}-leccion-${L.n}-${L.slug}-presentacion.docx`);
  fs.writeFileSync(pdfDocxPath, pdfBuf);
  console.log(`  + ${pdfDocxPath}`);

  // Workbook
  const wbDoc = buildWorkbookDoc(L);
  const wbBuf = await Packer.toBuffer(wbDoc);
  const wbPath = path.join(dir, `${L.level}-leccion-${L.n}-${L.slug}-cuaderno.docx`);
  fs.writeFileSync(wbPath, wbBuf);
  console.log(`  + ${wbPath}`);
}
console.log(`\n✔ Generados ${LECCIONES.length * 2} DOCX en ${ROOT}/`);
console.log(`  Después convertir los *-presentacion.docx → PDF (Word COM).`);
