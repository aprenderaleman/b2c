// Generador PREMIUM — diseño con marca completa.
// Por ahora genera UNA muestra (A1 Lektion 1) para revisión.
// Si el user aprueba, se itera sobre LECCIONES como en generate.mjs.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LECCIONES } from "./lecciones.mjs";

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer, PageBreak,
  HeightRule, VerticalAlign,
} = require("docx");

// ── Paleta oficial (de tailwind/globals) ─────────────────────
const NAVY        = "0F2847";
const NAVY_800    = "15315A";
const NAVY_700    = "1E3A66";
const NAVY_50     = "F4F6FA";
const WARM        = "F4A261";
const WARM_DARK   = "C75B12";
const ORANGE      = "F97316";
const WHITE       = "FFFFFF";
const TEXT_DARK   = "1A1D29";
const TEXT_MUTED  = "5E6878";
const BORDER_SOFT = "E2E8F0";

const ROOT     = "C:/Users/gelfi/Desktop/b2c/materiales-premium";
const LOGO     = fs.readFileSync("C:/Users/gelfi/Desktop/b2c/web/public/Logonewwithbg.png");

const noBorders = {
  top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const softBorders = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT },
  left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT },
  right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT },
};

// ── Helpers ──────────────────────────────────────────────────
function blank(spacingAfter = 120) {
  return new Paragraph({ spacing: { after: spacingAfter }, children: [new TextRun("")] });
}

function eyebrow(text, color = WARM_DARK) {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({
      text: text.toUpperCase(),
      bold: true, size: 18, color, font: "Calibri",
      characterSpacing: 80,
    })],
  });
}

function h1Serif(text, color = NAVY, size = 48) {
  return new Paragraph({
    spacing: { before: 100, after: 220 },
    children: [new TextRun({ text, bold: true, size, color, font: "Cambria" })],
  });
}

function bodyText(text, opts = {}) {
  const { size = 22, color = TEXT_DARK, italics = false, bold = false, spacingAfter = 120, align = AlignmentType.LEFT } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter, line: 320 },
    children: [new TextRun({ text, size, color, italics, bold, font: "Calibri" })],
  });
}

// Caja Spanish key — para A0/A1 solo. Fondo warm muy claro + texto navy.
function spanishKeyBox(text) {
  const cell = new TableCell({
    width: { size: 9360, type: WidthType.DXA },
    shading: { fill: "FFF4E6", type: ShadingType.CLEAR },  // warm/50 tone
    borders: {
      top:    { style: BorderStyle.NONE, size: 0, color: WHITE },
      bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
      right:  { style: BorderStyle.NONE, size: 0, color: WHITE },
      left:   { style: BorderStyle.SINGLE, size: 24, color: WARM_DARK },
    },
    margins: { top: 180, bottom: 180, left: 280, right: 220 },
    children: [
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: "💡  ", size: 24 }),
          new TextRun({
            text: "CLAVE EN ESPAÑOL", bold: true, size: 18, color: WARM_DARK,
            font: "Calibri", characterSpacing: 100,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 60, line: 320 },
        children: [new TextRun({ text, size: 22, color: TEXT_DARK, font: "Calibri" })],
      }),
    ],
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [cell] })],
  });
}

// Mini-diálogo en práctica (escenario real)
function practiceDialogue(inPractice) {
  const SPK = 1800, TXT = 7560;
  const rows = [
    // Header con escenario (1 sola celda spanning)
    new TableRow({ children: [new TableCell({
      borders: noBorders,
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 200, bottom: 200, left: 320, right: 320 },
      width: { size: SPK + TXT, type: WidthType.DXA },
      columnSpan: 2,
      children: [
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({
            text: `🎬  ${inPractice.title.toUpperCase()}`,
            bold: true, size: 20, color: WARM, font: "Calibri", characterSpacing: 80,
          })],
        }),
        new Paragraph({
          children: [new TextRun({
            text: inPractice.scenarioEs, italics: true, size: 20, color: NAVY_50, font: "Calibri",
          })],
        }),
      ],
    })]}),
    // Líneas del diálogo
    ...inPractice.dialogue.map((line, i) => new TableRow({
      children: [
        new TableCell({
          borders: noBorders,
          shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
          margins: { top: 120, bottom: 120, left: 320, right: 120 },
          width: { size: SPK, type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({ children: [new TextRun({
            text: line.speaker, bold: true, size: 20, color: WARM_DARK, font: "Calibri", characterSpacing: 40,
          })]})],
        }),
        new TableCell({
          borders: noBorders,
          shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
          margins: { top: 120, bottom: 120, left: 100, right: 320 },
          width: { size: TXT, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({
            text: line.text, size: 22, color: NAVY, font: "Cambria", italics: true,
          })]})],
        }),
      ],
    })),
  ];
  return new Table({
    width: { size: SPK + TXT, type: WidthType.DXA },
    columnWidths: [SPK, TXT],
    rows,
  });
}

// Tabla de errores comunes con 3 columnas estilizadas
function mistakesTable(items, langSpanish = true) {
  const cW = 9360;
  const rows = [
    // Header
    new TableRow({ children: [new TableCell({
      borders: noBorders,
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 280, right: 280 },
      width: { size: cW, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({
          text: langSpanish ? "⚠️  ERRORES COMUNES DEL HISPANOHABLANTE" : "⚠️  HÄUFIGE FEHLER",
          bold: true, size: 20, color: WARM, font: "Calibri", characterSpacing: 100,
        })],
      })],
    })]}),
    ...items.map((it, i) => new TableRow({ children: [new TableCell({
      borders: noBorders,
      shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
      margins: { top: 200, bottom: 200, left: 280, right: 280 },
      width: { size: cW, type: WidthType.DXA },
      children: [
        new Paragraph({
          spacing: { after: 80, line: 300 },
          children: [
            new TextRun({ text: "❌  ", bold: true, size: 24, color: "C00000" }),
            new TextRun({ text: it.wrong, size: 22, color: "C00000", font: "Cambria", italics: true, strike: false }),
          ],
        }),
        new Paragraph({
          spacing: { after: 100, line: 300 },
          children: [
            new TextRun({ text: "✅  ", bold: true, size: 24, color: "1F7A1F" }),
            new TextRun({ text: it.right, size: 22, color: "1F7A1F", font: "Cambria", italics: true, bold: true }),
          ],
        }),
        new Paragraph({
          spacing: { after: 0, line: 300 },
          indent: { left: 480 },
          children: [
            new TextRun({ text: it.why, size: 20, color: TEXT_MUTED, font: "Calibri" }),
          ],
        }),
      ],
    })]})),
  ];
  return new Table({
    width: { size: cW, type: WidthType.DXA },
    columnWidths: [cW],
    rows,
  });
}

// Caja destacada de gramática (fondo navy-50, padding, border-left warm)
function highlightBox(title, body, examples) {
  const rows = [];
  rows.push(new TableRow({ children: [new TableCell({
    width: { size: 9360, type: WidthType.DXA },
    shading: { fill: NAVY_50, type: ShadingType.CLEAR },
    borders: {
      top:    { style: BorderStyle.NONE, size: 0, color: WHITE },
      bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
      right:  { style: BorderStyle.NONE, size: 0, color: WHITE },
      left:   { style: BorderStyle.SINGLE, size: 24, color: WARM },
    },
    margins: { top: 200, bottom: 200, left: 280, right: 200 },
    children: [
      new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: title, bold: true, size: 24, color: NAVY, font: "Cambria" })],
      }),
      new Paragraph({
        spacing: { after: 160, line: 320 },
        children: [new TextRun({ text: body, size: 21, color: TEXT_DARK, font: "Calibri" })],
      }),
      ...examples.map(ex => new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: "›  ", bold: true, size: 22, color: WARM_DARK, font: "Calibri" }),
          new TextRun({ text: ex, size: 22, color: NAVY, font: "Cambria", italics: true }),
        ],
      })),
    ],
  })]}));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows,
  });
}

function vocabTable(items) {
  const cw1 = 4400, cw2 = 4960;
  const headerRow = new TableRow({
    tableHeader: true,
    height: { value: 480, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        borders: noBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 140, bottom: 140, left: 200, right: 200 },
        verticalAlign: VerticalAlign.CENTER,
        width: { size: cw1, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({
          text: "DEUTSCH", bold: true, size: 20, color: WHITE, font: "Calibri", characterSpacing: 60,
        })]})],
      }),
      new TableCell({
        borders: noBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 140, bottom: 140, left: 200, right: 200 },
        verticalAlign: VerticalAlign.CENTER,
        width: { size: cw2, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({
          text: "ESPAÑOL", bold: true, size: 20, color: WHITE, font: "Calibri", characterSpacing: 60,
        })]})],
      }),
    ],
  });
  const dataRows = items.map((it, i) => new TableRow({
    height: { value: 360, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        borders: {
          top:    { style: BorderStyle.NONE, size: 0, color: WHITE },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
          left:   { style: BorderStyle.NONE, size: 0, color: WHITE },
          right:  { style: BorderStyle.NONE, size: 0, color: WHITE },
        },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 200, right: 120 },
        width: { size: cw1, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.de, bold: true, size: 22, color: NAVY, font: "Cambria",
        })]})],
      }),
      new TableCell({
        borders: {
          top:    { style: BorderStyle.NONE, size: 0, color: WHITE },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
          left:   { style: BorderStyle.NONE, size: 0, color: WHITE },
          right:  { style: BorderStyle.NONE, size: 0, color: WHITE },
        },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 200 },
        width: { size: cw2, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.es, size: 22, color: TEXT_MUTED, font: "Calibri", italics: true,
        })]})],
      }),
    ],
  }));
  return new Table({
    width: { size: cw1 + cw2, type: WidthType.DXA },
    columnWidths: [cw1, cw2],
    rows: [headerRow, ...dataRows],
  });
}

// Header de página (todas las páginas excepto cover)
function pageHeader(L) {
  return new Header({
    children: [new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 4680],
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorders, width: { size: 4680, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 0, right: 0 },
            children: [new Paragraph({
              children: [
                new ImageRun({
                  type: "png", data: LOGO,
                  transformation: { width: 22, height: 22 },
                  altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
                }),
                new TextRun({ text: "  Aprender-Aleman", bold: true, size: 18, color: NAVY, font: "Calibri" }),
                new TextRun({ text: ".de", bold: true, size: 18, color: WARM_DARK, font: "Calibri" }),
              ],
            })],
          }),
          new TableCell({
            borders: noBorders, width: { size: 4680, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 0, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({
                text: `NIVEAU ${L.level}  ·  LEKTION ${L.n}`,
                size: 16, color: TEXT_MUTED, font: "Calibri", characterSpacing: 60, bold: true,
              })],
            })],
          }),
        ],
      })],
    })],
  });
}

function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT, space: 6 } },
      children: [
        new TextRun({ text: "Aprender-Aleman", size: 16, color: NAVY, bold: true, font: "Calibri" }),
        new TextRun({ text: ".de", size: 16, color: WARM_DARK, bold: true, font: "Calibri" }),
        new TextRun({ text: "  ·  Online-Deutschakademie  ·  Seite ", size: 16, color: TEXT_MUTED, font: "Calibri" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: TEXT_MUTED, font: "Calibri", bold: true }),
      ],
    })],
  });
}

// ─── COVER (full navy page) ────────────────────────────────
function buildCoverSection(L, subtitle = "Lehrerpräsentation") {
  // Una tabla 1×1 que cubre toda la página (ancho = page width minus 0 margin).
  // Dentro vamos verticalmente: logo (top), spacer, eyebrow, título, subtítulo, spacer, footer-cover.
  // Para landscape A4 con margin=0: width=11906, height=16838 (pero recordar que landscape
  // intercambia en docx-js: pasamos width=11906 height=16838, orientation=LANDSCAPE).
  const PAGE_W = 16838;  // landscape: el ancho VISUAL es el lado largo
  const PAGE_H = 11906;  // alto visual = lado corto
  // Margenes del page = 0, pero la tabla tiene su propio padding interno
  const innerCells = [];

  // Top: logo + nombre marca
  innerCells.push(new Paragraph({
    spacing: { before: 800, after: 200 },
    alignment: AlignmentType.LEFT,
    children: [
      new ImageRun({
        type: "png", data: LOGO,
        transformation: { width: 56, height: 56 },
        altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
      }),
      new TextRun({ text: "   Aprender-Aleman", bold: true, size: 28, color: WHITE, font: "Calibri" }),
      new TextRun({ text: ".de", bold: true, size: 28, color: WARM, font: "Calibri" }),
    ],
  }));

  // Spacer
  innerCells.push(new Paragraph({ spacing: { after: 1800 }, children: [new TextRun({ text: "", size: 24 })] }));

  // Eyebrow
  innerCells.push(new Paragraph({
    spacing: { after: 280 },
    children: [new TextRun({
      text: `DEUTSCHKURS  ·  NIVEAU ${L.level}  ·  LEKTION ${L.n}`,
      bold: true, size: 22, color: WARM, font: "Calibri", characterSpacing: 200,
    })],
  }));

  // Título serif grande
  innerCells.push(new Paragraph({
    spacing: { after: 220 },
    children: [new TextRun({
      text: L.title,
      bold: true, size: 80, color: WHITE, font: "Cambria",
    })],
  }));

  // Subtítulo
  innerCells.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: subtitle, italics: true, size: 28, color: NAVY_50, font: "Cambria",
    })],
  }));

  // Spacer
  innerCells.push(new Paragraph({ spacing: { after: 1800 }, children: [new TextRun({ text: "", size: 24 })] }));

  // Footer cover: línea separadora visual + datos
  innerCells.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: WARM, space: 6 } },
    children: [new TextRun({ text: " ", size: 12 })],
  }));
  innerCells.push(new Paragraph({
    children: [
      new TextRun({ text: "Online-Deutschakademie  ·  Muttersprachliche Lehrkräfte  ·  ", size: 18, color: NAVY_50, font: "Calibri" }),
      new TextRun({ text: "aprender-aleman.de", size: 18, color: WARM, bold: true, font: "Calibri" }),
    ],
  }));

  const fullCell = new TableCell({
    borders: noBorders,
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    width: { size: PAGE_W, type: WidthType.DXA },
    margins: { top: 600, bottom: 600, left: 1400, right: 1400 },
    children: innerCells,
  });

  const coverTable = new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [PAGE_W],
    rows: [new TableRow({
      height: { value: PAGE_H, rule: HeightRule.EXACT },
      children: [fullCell],
    })],
  });

  return {
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    },
    children: [coverTable],
  };
}

// ─── Sections de contenido (con header/footer) ─────────────
function contentSection(L, children) {
  return {
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 1200, right: 1440, bottom: 1080, left: 1440 },
      },
    },
    headers: { default: pageHeader(L) },
    footers: { default: pageFooter() },
    children,
  };
}

// ─── BUILD PDF DOC (presentación profesor) ────────────────
function buildPresentationDoc(L) {
  const sections = [];
  sections.push(buildCoverSection(L, "Lehrerpräsentation für den Unterricht"));

  // Section 2: Lernziele
  const lernzieleChildren = [
    eyebrow("Lernziele dieser Lektion"),
    h1Serif("Was wirst du heute lernen?", NAVY, 52),
    blank(200),
    ...L.learningObjectives.flatMap((obj, i) => ([
      new Paragraph({
        spacing: { after: 320, line: 320 },
        children: [
          new TextRun({ text: String(i + 1).padStart(2, "0"), bold: true, size: 56, color: WARM, font: "Cambria" }),
          new TextRun({ text: "    ", size: 24 }),
          new TextRun({ text: obj, size: 28, color: TEXT_DARK, font: "Calibri" }),
        ],
      }),
    ])),
    new Paragraph({ children: [new PageBreak()] }),

    // Vocabulario
    eyebrow("Wortschatz"),
    h1Serif("Neue Wörter dieser Lektion", NAVY, 44),
    blank(160),
    vocabTable(L.vocabulary),
    new Paragraph({ children: [new PageBreak()] }),

    // Grammatik
    eyebrow("Grammatik im Fokus"),
    h1Serif(L.grammar.title, NAVY, 40),
    blank(160),
    highlightBox("Erklärung", L.grammar.explanation, L.grammar.examples),
    ...(L.grammarSpanishKey ? [blank(180), spanishKeyBox(L.grammarSpanishKey)] : []),
    new Paragraph({ children: [new PageBreak()] }),

    // Beispiele
    eyebrow("Beispiele aus dem Alltag"),
    h1Serif("So benutzt man es wirklich", NAVY, 44),
    blank(200),
    ...L.examples.flatMap(ex => [
      new Paragraph({
        spacing: { after: 280, line: 320 },
        border: { left: { style: BorderStyle.SINGLE, size: 16, color: WARM, space: 12 } },
        indent: { left: 240 },
        children: [
          new TextRun({ text: ex, size: 30, color: NAVY, font: "Cambria", italics: true }),
        ],
      }),
    ]),
    new Paragraph({ children: [new PageBreak()] }),

    // ⭐ In der Praxis — mini-diálogo en situación real
    ...(L.inPractice ? [
      eyebrow("In der Praxis"),
      h1Serif("Ein echter Dialog", NAVY, 44),
      blank(160),
      practiceDialogue(L.inPractice),
      new Paragraph({ children: [new PageBreak()] }),
    ] : []),

    // ⭐ Häufige Fehler — errores comunes del hispanohablante
    ...(L.commonMistakes && L.commonMistakes.length > 0 ? [
      eyebrow("Häufige Fehler"),
      h1Serif("Was Spanischsprachige oft falsch machen", NAVY, 40),
      blank(160),
      mistakesTable(L.commonMistakes, true),
      new Paragraph({ children: [new PageBreak()] }),
    ] : []),

    // Übung
    eyebrow("Aktivität im Unterricht"),
    h1Serif("Lass uns das jetzt üben", NAVY, 44),
    blank(200),
    bodyText(L.classExercise, { size: 28, color: TEXT_DARK, spacingAfter: 240 }),
    new Paragraph({ children: [new PageBreak()] }),

    // Hausaufgabe
    eyebrow("Hausaufgabe"),
    h1Serif("Für die nächste Stunde", NAVY, 44),
    blank(200),
    bodyText(L.homework, { size: 28, color: TEXT_DARK, spacingAfter: 240 }),
    new Paragraph({ children: [new PageBreak()] }),

    // Zusammenfassung
    eyebrow("Zusammenfassung"),
    h1Serif("Was du jetzt kannst", NAVY, 48),
    blank(200),
    new Paragraph({
      spacing: { after: 200, line: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: WARM, space: 16 } },
      indent: { left: 320 },
      children: [
        new TextRun({ text: L.summary, size: 32, color: NAVY, font: "Cambria", italics: true }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),

    // Closing
    blank(800),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [
        new ImageRun({
          type: "png", data: LOGO,
          transformation: { width: 80, height: 80 },
          altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [
        new TextRun({ text: "Vielen Dank!", bold: true, size: 80, color: NAVY, font: "Cambria" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 320 },
      children: [
        new TextRun({ text: "Bis zur nächsten Stunde 👋", size: 30, color: TEXT_MUTED, font: "Cambria", italics: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 800 },
      children: [
        new TextRun({ text: "aprender-aleman.de", bold: true, size: 22, color: WARM_DARK, font: "Calibri", characterSpacing: 100 }),
      ],
    }),
  ];
  sections.push(contentSection(L, lernzieleChildren));

  return new Document({
    creator: "Aprender-Aleman.de",
    title: `${L.level} · Lektion ${L.n} · ${L.title}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections,
  });
}

// ─── BUILD WORKBOOK DOC (cuaderno alumno) ──────────────────
function buildWorkbookDoc(L) {
  const sections = [];

  // Portrait cover (más cuaderno-vertical)
  const PAGE_W = 11906;
  const PAGE_H = 16838;

  const coverCell = new TableCell({
    borders: noBorders,
    shading: { fill: NAVY, type: ShadingType.CLEAR },
    width: { size: PAGE_W, type: WidthType.DXA },
    margins: { top: 800, bottom: 800, left: 1200, right: 1200 },
    children: [
      new Paragraph({
        spacing: { before: 600, after: 200 },
        children: [
          new ImageRun({
            type: "png", data: LOGO,
            transformation: { width: 50, height: 50 },
            altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
          }),
          new TextRun({ text: "   Aprender-Aleman", bold: true, size: 26, color: WHITE, font: "Calibri" }),
          new TextRun({ text: ".de", bold: true, size: 26, color: WARM, font: "Calibri" }),
        ],
      }),
      new Paragraph({ spacing: { after: 2400 }, children: [new TextRun({ text: "", size: 24 })] }),
      new Paragraph({
        spacing: { after: 260 },
        children: [new TextRun({
          text: `ÜBUNGSHEFT  ·  NIVEAU ${L.level}  ·  LEKTION ${L.n}`,
          bold: true, size: 20, color: WARM, font: "Calibri", characterSpacing: 200,
        })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({
          text: L.title, bold: true, size: 64, color: WHITE, font: "Cambria",
        })],
      }),
      new Paragraph({
        spacing: { after: 1400 },
        children: [new TextRun({
          text: "Dein persönliches Übungsheft zum Mitschreiben",
          italics: true, size: 24, color: NAVY_50, font: "Cambria",
        })],
      }),
      // Bloque "name + datum"
      new Paragraph({
        spacing: { before: 600, after: 80 },
        border: { top: { style: BorderStyle.SINGLE, size: 8, color: WARM, space: 6 } },
        children: [new TextRun({ text: " ", size: 12 })],
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: "Name:  ", bold: true, size: 22, color: NAVY_50, font: "Calibri" }),
          new TextRun({ text: "____________________________________", size: 22, color: WARM, font: "Calibri" }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Datum:  ", bold: true, size: 22, color: NAVY_50, font: "Calibri" }),
          new TextRun({ text: "________________________", size: 22, color: WARM, font: "Calibri" }),
        ],
      }),
    ],
  });

  const coverTable = new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [PAGE_W],
    rows: [new TableRow({
      height: { value: PAGE_H, rule: HeightRule.EXACT },
      children: [coverCell],
    })],
  });

  sections.push({
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    },
    children: [coverTable],
  });

  // Contenido (portrait)
  const contentChildren = [
    // Lernziele
    eyebrow("Lernziele"),
    h1Serif("Was du in dieser Lektion lernst", NAVY, 36),
    ...L.learningObjectives.map(obj => new Paragraph({
      numbering: { reference: "bullets", level: 0 },
      spacing: { after: 120 },
      children: [new TextRun({ text: obj, size: 22, color: TEXT_DARK, font: "Calibri" })],
    })),
    blank(240),

    // Wortschatz
    eyebrow("Wortschatz"),
    h1Serif("Wörterliste mit Platz für Notizen", NAVY, 32),
    blank(120),
    vocabWithNotesTable(L.vocabulary),
    blank(240),

    // Grammatik
    eyebrow("Grammatik"),
    h1Serif(L.grammar.title, NAVY, 30),
    blank(120),
    highlightBox("Die Regel", L.grammar.explanation, L.grammar.examples),
    ...(L.grammarSpanishKey ? [blank(180), spanishKeyBox(L.grammarSpanishKey)] : []),
    blank(240),

    // ⭐ In der Praxis
    ...(L.inPractice ? [
      eyebrow("In der Praxis"),
      h1Serif("Ein echter Dialog", NAVY, 28),
      blank(120),
      practiceDialogue(L.inPractice),
      blank(240),
    ] : []),

    // ⭐ Häufige Fehler
    ...(L.commonMistakes && L.commonMistakes.length > 0 ? [
      eyebrow("Häufige Fehler"),
      h1Serif("Errores que debes evitar", NAVY, 28),
      blank(120),
      mistakesTable(L.commonMistakes, true),
      blank(240),
    ] : []),

    // Notas espacio
    eyebrow("Meine Notizen"),
    ...Array.from({ length: 6 }).map(() => new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT, space: 6 } },
      children: [new TextRun({ text: " ", size: 22 })],
    })),
    blank(240),

    // Übungen
    eyebrow("Übungen"),
    h1Serif("Jetzt bist du dran", NAVY, 32),
    blank(200),
    ...L.workbookExercises.flatMap(ex => [
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: ex.title, bold: true, size: 24, color: NAVY, font: "Cambria" }),
        ],
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({ text: ex.instruction, size: 22, color: WARM_DARK, font: "Calibri", italics: true }),
        ],
      }),
      ...String(ex.content).split("\n").map(line => new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: line, size: 22, color: TEXT_DARK, font: "Consolas" })],
      })),
      blank(280),
    ]),

    // Hausaufgabe
    eyebrow("Hausaufgabe"),
    h1Serif("Für zu Hause", NAVY, 32),
    blank(120),
    bodyText(L.homework, { size: 22, color: TEXT_DARK, spacingAfter: 240 }),
    ...Array.from({ length: 8 }).map(() => new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT, space: 6 } },
      children: [new TextRun({ text: " ", size: 22 })],
    })),
    blank(240),

    // Cierre con logo
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 600, after: 120 },
      children: [
        new ImageRun({
          type: "png", data: LOGO,
          transformation: { width: 40, height: 40 },
          altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Gut gemacht!", bold: true, size: 32, color: NAVY, font: "Cambria" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 320 },
      children: [
        new TextRun({ text: "aprender-aleman.de", bold: true, size: 18, color: WARM_DARK, font: "Calibri", characterSpacing: 100 }),
      ],
    }),
  ];

  sections.push({
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: 1200, right: 1200, bottom: 1080, left: 1200 },
      },
    },
    headers: { default: pageHeader(L) },
    footers: { default: pageFooter() },
    children: contentChildren,
  });

  return new Document({
    creator: "Aprender-Aleman.de",
    title: `Übungsheft ${L.level} Lektion ${L.n} — ${L.title}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    numbering: {
      config: [
        { reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "▸", alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 540, hanging: 280 } },
              run: { color: WARM_DARK, font: "Calibri", bold: true },
            }}] },
      ],
    },
    sections,
  });
}

function vocabWithNotesTable(items) {
  const cw1 = 2800, cw2 = 2800, cw3 = 2800;
  const headerRow = new TableRow({
    tableHeader: true,
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: ["DEUTSCH", "ESPAÑOL", "MEINE NOTIZ"].map((label, i) => new TableCell({
      borders: noBorders,
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      verticalAlign: VerticalAlign.CENTER,
      width: { size: [cw1, cw2, cw3][i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({
        text: label, bold: true, size: 18, color: WHITE, font: "Calibri", characterSpacing: 60,
      })]})],
    })),
  });
  const dataRows = items.map((it, i) => new TableRow({
    height: { value: 360, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        borders: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
          top: { style: BorderStyle.NONE, size: 0, color: WHITE },
          left: { style: BorderStyle.NONE, size: 0, color: WHITE },
          right: { style: BorderStyle.NONE, size: 0, color: WHITE } },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 160, right: 100 },
        width: { size: cw1, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.de, bold: true, size: 21, color: NAVY, font: "Cambria",
        })]})],
      }),
      new TableCell({
        borders: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
          top: { style: BorderStyle.NONE, size: 0, color: WHITE },
          left: { style: BorderStyle.NONE, size: 0, color: WHITE },
          right: { style: BorderStyle.NONE, size: 0, color: WHITE } },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        width: { size: cw2, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.es, size: 21, color: TEXT_MUTED, font: "Calibri", italics: true,
        })]})],
      }),
      new TableCell({
        borders: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
          top: { style: BorderStyle.NONE, size: 0, color: WHITE },
          left: { style: BorderStyle.NONE, size: 0, color: WHITE },
          right: { style: BorderStyle.NONE, size: 0, color: WHITE } },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 160 },
        width: { size: cw3, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({ text: "", size: 21 })] })],
      }),
    ],
  }));
  return new Table({
    width: { size: cw1 + cw2 + cw3, type: WidthType.DXA },
    columnWidths: [cw1, cw2, cw3],
    rows: [headerRow, ...dataRows],
  });
}

// ─── Main: solo A1 L1 como muestra ──────────────────────────
const sample = LECCIONES.find(L => L.level === "A1" && L.n === 1);
if (!sample) { console.error("No A1 L1 found"); process.exit(1); }

fs.mkdirSync(ROOT, { recursive: true });

const pdfDoc = buildPresentationDoc(sample);
const pdfBuf = await Packer.toBuffer(pdfDoc);
const pdfPath = path.join(ROOT, `${sample.level}-leccion-${sample.n}-${sample.slug}-presentacion.docx`);
fs.writeFileSync(pdfPath, pdfBuf);
console.log(`✔ ${pdfPath}  (${(pdfBuf.length / 1024).toFixed(1)} KB)`);

const wbDoc = buildWorkbookDoc(sample);
const wbBuf = await Packer.toBuffer(wbDoc);
const wbPath = path.join(ROOT, `${sample.level}-leccion-${sample.n}-${sample.slug}-cuaderno.docx`);
fs.writeFileSync(wbPath, wbBuf);
console.log(`✔ ${wbPath}  (${(wbBuf.length / 1024).toFixed(1)} KB)`);

console.log("\nAhora convertir a PDF via Word COM (segundo paso).");
