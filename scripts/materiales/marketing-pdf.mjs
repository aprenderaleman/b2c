// Generador de PDFs marketing/nurturing por nivel.
// 5 PDFs (A0, A1.1, A1.2, A2.1, A2.2), 5 páginas cada uno.
// Por ahora solo el PDF 1 (A0) como muestra.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer, PageBreak,
  HeightRule, VerticalAlign, ExternalHyperlink,
} = require("docx");

// ── Paleta y assets ────────────────────────────────────────
const NAVY        = "0F2847";
const NAVY_800    = "15315A";
const NAVY_50     = "F4F6FA";
const WARM        = "F4A261";
const WARM_DARK   = "C75B12";
const WARM_50     = "FFF4E6";
const WHITE       = "FFFFFF";
const TEXT_DARK   = "1A1D29";
const TEXT_MUTED  = "5E6878";
const BORDER_SOFT = "E2E8F0";
const SUCCESS     = "2D6A4F";

const ROOT = "C:/Users/gelfi/Desktop/b2c/materiales-marketing";
const LOGO = fs.readFileSync("C:/Users/gelfi/Desktop/b2c/scripts/materiales/logo-small.png");

const noBorders = {
  top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const URL = "https://b2c.aprender-aleman.de";

// ── Datos del PDF 1: A0 ────────────────────────────────────
const PDF1 = {
  level: "A0",
  pdfNumber: 1,
  totalPdfs: 7,
  title: "Tus primeros pasos en alemán",
  subtitle: "Lo esencial para arrancar sin trabarte",
  introText:
    "En las próximas 5 minutos vas a aprender lo que muchos no saben tras meses de apps: cómo saludar, presentarte y formar tus primeras frases reales en alemán. Sin teoría aburrida — solo lo que vas a usar mañana mismo.",

  vocab: {
    title: "Frases que vas a usar hoy mismo",
    items: [
      { de: "Hallo!",                     es: "¡Hola! (informal, cualquier momento)" },
      { de: "Guten Tag!",                 es: "¡Buenos días/tardes! (formal)" },
      { de: "Tschüss!",                   es: "¡Chao! (informal)" },
      { de: "Auf Wiedersehen!",           es: "¡Hasta la vista! (formal)" },
      { de: "Ich heiße…",                 es: "Me llamo…" },
      { de: "Ich komme aus Spanien.",     es: "Vengo de España." },
      { de: "Ich wohne in Berlin.",       es: "Vivo en Berlín." },
      { de: "Wie heißt du?",              es: "¿Cómo te llamas? (informal)" },
      { de: "Wie heißen Sie?",            es: "¿Cómo se llama? (formal)" },
      { de: "Es freut mich!",             es: "¡Encantado/a!" },
      { de: "Wie geht's?",                es: "¿Qué tal?" },
      { de: "Gut, danke. Und dir?",       es: "Bien, gracias. ¿Y tú?" },
      { de: "Ich verstehe nicht.",        es: "No entiendo." },
      { de: "Sprechen Sie Englisch?",     es: "¿Habla inglés?" },
      { de: "Vielen Dank!",               es: "¡Muchas gracias!" },
    ],
    truco: "Si dudas entre formal e informal, usa „Sie“. Los alemanes valoran la cortesía con desconocidos — nunca es ofensivo, al contrario.",
  },

  grammar: {
    title: "La base: pronombres + sein/haben",
    intro: "Estos dos verbos son los CIMIENTOS del alemán. Sin ellos no formas ni una frase. Y son irregulares — toca memorizarlos. Pero solo son 6 formas cada uno, y los usarás todos los días.",
    table: [
      ["", "SEIN (ser/estar)", "HABEN (tener)"],
      ["ich (yo)",             "bin",  "habe"],
      ["du (tú)",              "bist", "hast"],
      ["er/sie/es (él/ella)",  "ist",  "hat"],
      ["wir (nosotros)",       "sind", "haben"],
      ["ihr (vosotros)",       "seid", "habt"],
      ["sie/Sie (ellos/usted)","sind", "haben"],
    ],
    examples: [
      "Ich BIN müde.   →   Estoy cansado.",
      "Du BIST nett.   →   Eres simpático.",
      "Ich HABE Hunger.   →   Tengo hambre.",
      "Wir HABEN Zeit.   →   Tenemos tiempo.",
    ],
    claveEs:
      "💡 La trampa más común: el alemán NO distingue entre „ser“ y „estar“ — ambos son SEIN. Pero atención: para hambre, sed, miedo, frío, calor usa HABEN (igual que en español „tengo hambre“, no „soy hambre“). Regla simple: adjetivo → SEIN. Sustantivo → HABEN.",
  },

  dialogue: {
    title: "Primer encuentro en un café berlinés",
    scenarioEs: "Sábado por la mañana en el Mauerpark. Pides un café y un alemán amable te saluda en la fila.",
    lines: [
      { s: "Marc",  t: "Hallo! Bist du auch neu hier?" },
      { s: "Tú",    t: "Ja! Ich heiße Sofia. Und du?" },
      { s: "Marc",  t: "Ich bin Marc. Es freut mich! Woher kommst du?" },
      { s: "Tú",    t: "Ich komme aus Spanien. Ich wohne jetzt in Berlin." },
      { s: "Marc",  t: "Cool! Hast du WhatsApp? Wir könnten uns mal treffen." },
      { s: "Tú",    t: "Klar! Ich gebe dir meine Nummer." },
    ],
  },

  mistakes: [
    {
      wrong: "Ich heiße ist Pedro.",
      right: "Ich heiße Pedro.",
      why:   "„Heißen“ ya significa „llamarse“. No le añadas „ist“. Sería como decir „me llamo es Pedro“.",
    },
    {
      wrong: "Ich bin Hunger.",
      right: "Ich HABE Hunger.",
      why:   "Hambre, sed, miedo, frío → con HABEN (tener), no con SEIN. Igual que en español.",
    },
    {
      wrong: "Ich komme von Spanien.",
      right: "Ich komme AUS Spanien.",
      why:   "El verbo „kommen“ (de un país/ciudad) siempre va con „aus“. „Von“ se usa para personas.",
    },
  ],

  testimonials: [
    {
      name: "Marta R.",
      city: "Valencia · 29 años",
      levelStart: "A0",
      levelNow:   "A2",
      text: "En 3 semanas ya saludaba sin trabarme. Me dio la confianza que necesitaba para no rendirme.",
    },
    {
      name: "Carlos M.",
      city: "Sevilla · 34 años",
      levelStart: "A0",
      levelNow:   "B1",
      text: "Necesitaba alemán para una oferta de trabajo en Múnich. Empecé desde cero. En 6 meses pasé a B1 y conseguí el puesto. La diferencia con las apps fue brutal: aquí me corregían cada error con paciencia.",
    },
    {
      name: "Sofía P.",
      city: "Quito · 22 años",
      levelStart: "A0",
      levelNow:   "A2",
      text: "Me mudé a Berlín sin saber nada. Hoy puedo hacer la compra y abrir una cuenta en el banco sola.",
    },
  ],
};

// ── Helpers ────────────────────────────────────────────────
function p(text, opts = {}) {
  const {
    bold = false, size = 22, color = TEXT_DARK, italics = false,
    align = AlignmentType.LEFT, spacingAfter = 100, font = "Calibri",
  } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter, line: 300 },
    children: [new TextRun({ text, bold, size, color, italics, font })],
  });
}

function eyebrow(text, color = WARM_DARK, spacingAfter = 80) {
  return new Paragraph({
    spacing: { after: spacingAfter },
    children: [new TextRun({
      text: text.toUpperCase(),
      bold: true, size: 18, color, font: "Calibri", characterSpacing: 100,
    })],
  });
}

function h1Serif(text, color = NAVY, size = 40) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    children: [new TextRun({ text, bold: true, size, color, font: "Cambria" })],
  });
}

function h2Serif(text, color = NAVY, size = 30) {
  return new Paragraph({
    spacing: { before: 60, after: 140 },
    children: [new TextRun({ text, bold: true, size, color, font: "Cambria" })],
  });
}

function blank(spacingAfter = 100) {
  return new Paragraph({ spacing: { after: spacingAfter }, children: [new TextRun("")] });
}

// Caja warm "Truco"
function trucoBox(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: {
        ...noBorders,
        left: { style: BorderStyle.SINGLE, size: 24, color: WARM_DARK },
      },
      shading: { fill: WARM_50, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 280, right: 220 },
      width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: "💡  ", size: 22 }),
            new TextRun({ text: "TRUCO RÁPIDO", bold: true, size: 18, color: WARM_DARK, font: "Calibri", characterSpacing: 100 }),
          ],
        }),
        new Paragraph({
          spacing: { line: 320 },
          children: [new TextRun({ text, size: 21, color: TEXT_DARK, font: "Calibri" })],
        }),
      ],
    })]})],
  });
}

// Caja navy "Clave en español"
function claveEsBox(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: {
        ...noBorders,
        left: { style: BorderStyle.SINGLE, size: 24, color: WARM },
      },
      shading: { fill: NAVY_50, type: ShadingType.CLEAR },
      margins: { top: 180, bottom: 180, left: 280, right: 220 },
      width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({
            text: "CLAVE EN ESPAÑOL", bold: true, size: 18, color: NAVY, font: "Calibri", characterSpacing: 100,
          })],
        }),
        new Paragraph({
          spacing: { line: 320 },
          children: [new TextRun({ text, size: 21, color: TEXT_DARK, font: "Calibri" })],
        }),
      ],
    })]})],
  });
}

// Vocabulario en tabla compacta
function vocabTable(items) {
  const cw1 = 4000, cw2 = 5360;
  const dataRows = items.map((it, i) => new TableRow({
    height: { value: 320, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        borders: {
          ...noBorders,
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
        },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 70, bottom: 70, left: 180, right: 100 },
        width: { size: cw1, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.de, bold: true, size: 22, color: NAVY, font: "Cambria",
        })]})],
      }),
      new TableCell({
        borders: {
          ...noBorders,
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_SOFT },
        },
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 70, bottom: 70, left: 100, right: 180 },
        width: { size: cw2, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [new TextRun({
          text: it.es, size: 20, color: TEXT_MUTED, font: "Calibri", italics: true,
        })]})],
      }),
    ],
  }));
  return new Table({
    width: { size: cw1 + cw2, type: WidthType.DXA },
    columnWidths: [cw1, cw2],
    rows: dataRows,
  });
}

// Tabla SEIN/HABEN
function conjugationTable(rows) {
  const cw1 = 3360, cw2 = 3000, cw3 = 3000;
  return new Table({
    width: { size: cw1 + cw2 + cw3, type: WidthType.DXA },
    columnWidths: [cw1, cw2, cw3],
    rows: rows.map((r, i) => new TableRow({
      height: { value: 360, rule: HeightRule.ATLEAST },
      children: r.map((cell, j) => new TableCell({
        borders: {
          ...noBorders,
          bottom: { style: BorderStyle.SINGLE, size: i === 0 ? 8 : 2, color: i === 0 ? NAVY : BORDER_SOFT },
        },
        shading: i === 0
          ? { fill: NAVY, type: ShadingType.CLEAR }
          : i % 2 === 0 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 100, bottom: 100, left: 180, right: 100 },
        width: { size: [cw1, cw2, cw3][j], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.LEFT,
          children: [new TextRun({
            text: cell,
            bold: i === 0 || j > 0,
            size: i === 0 ? 20 : 22,
            color: i === 0 ? WHITE : (j === 0 ? TEXT_MUTED : NAVY),
            font: i === 0 ? "Calibri" : (j > 0 ? "Cambria" : "Calibri"),
            characterSpacing: i === 0 ? 80 : 0,
            italics: j === 0 && i > 0,
          })],
        })],
      })),
    })),
  });
}

// Diálogo
function dialogueBox(title, scenarioEs, lines) {
  const SPK = 1600, TXT = 7760;
  return new Table({
    width: { size: SPK + TXT, type: WidthType.DXA },
    columnWidths: [SPK, TXT],
    rows: [
      // Header
      new TableRow({ children: [new TableCell({
        borders: noBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 180, bottom: 180, left: 280, right: 280 },
        width: { size: SPK + TXT, type: WidthType.DXA },
        columnSpan: 2,
        children: [
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({
              text: `🎬  ${title.toUpperCase()}`,
              bold: true, size: 19, color: WARM, font: "Calibri", characterSpacing: 80,
            })],
          }),
          new Paragraph({
            children: [new TextRun({
              text: scenarioEs, italics: true, size: 19, color: NAVY_50, font: "Calibri",
            })],
          }),
        ],
      })]}),
      // Lines
      ...lines.map((line, i) => new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
            margins: { top: 100, bottom: 100, left: 280, right: 100 },
            width: { size: SPK, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            children: [new Paragraph({ children: [new TextRun({
              text: line.s, bold: true, size: 19, color: WARM_DARK, font: "Calibri",
            })]})],
          }),
          new TableCell({
            borders: noBorders,
            shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
            margins: { top: 100, bottom: 100, left: 80, right: 280 },
            width: { size: TXT, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({
              text: line.t, size: 21, color: NAVY, font: "Cambria", italics: true,
            })]})],
          }),
        ],
      })),
    ],
  });
}

// Errores comunes
function mistakesTable(items) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({ children: [new TableCell({
        borders: noBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 140, bottom: 140, left: 280, right: 280 },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({
            text: "⚠️  ERRORES TÍPICOS DEL HISPANOHABLANTE",
            bold: true, size: 19, color: WARM, font: "Calibri", characterSpacing: 100,
          })],
        })],
      })]}),
      ...items.map((it, i) => new TableRow({ children: [new TableCell({
        borders: noBorders,
        shading: i % 2 ? { fill: NAVY_50, type: ShadingType.CLEAR } : undefined,
        margins: { top: 160, bottom: 160, left: 280, right: 280 },
        width: { size: 9360, type: WidthType.DXA },
        children: [
          new Paragraph({
            spacing: { after: 60, line: 280 },
            children: [
              new TextRun({ text: "❌  ", bold: true, size: 22, color: "C00000" }),
              new TextRun({ text: it.wrong, size: 21, color: "C00000", font: "Cambria", italics: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80, line: 280 },
            children: [
              new TextRun({ text: "✅  ", bold: true, size: 22, color: SUCCESS }),
              new TextRun({ text: it.right, size: 21, color: SUCCESS, font: "Cambria", bold: true }),
            ],
          }),
          new Paragraph({
            spacing: { line: 280 },
            indent: { left: 360 },
            children: [new TextRun({ text: it.why, size: 19, color: TEXT_MUTED, font: "Calibri" })],
          }),
        ],
      })]})),
    ],
  });
}

// Testimonio individual
function testimonialCard(t, accent = WARM) {
  const initials = t.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2);
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 7760],
    rows: [new TableRow({ children: [
      // Avatar circle
      new TableCell({
        borders: noBorders,
        shading: { fill: accent, type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
        width: { size: 1600, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: initials, bold: true, size: 36, color: NAVY, font: "Cambria",
          })],
        })],
      }),
      // Content
      new TableCell({
        borders: noBorders,
        shading: { fill: NAVY_50, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 280, right: 240 },
        width: { size: 7760, type: WidthType.DXA },
        children: [
          // Name + nivel badge
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: t.name, bold: true, size: 22, color: NAVY, font: "Cambria" }),
              new TextRun({ text: `   ·   ${t.city}`, size: 18, color: TEXT_MUTED, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({ text: `${t.levelStart} → ${t.levelNow}`,
                bold: true, size: 16, color: WARM_DARK, font: "Calibri", characterSpacing: 100 }),
            ],
          }),
          new Paragraph({
            spacing: { line: 300 },
            children: [
              new TextRun({ text: "„", bold: true, size: 28, color: WARM, font: "Cambria" }),
              new TextRun({ text: t.text, italics: true, size: 21, color: TEXT_DARK, font: "Cambria" }),
              new TextRun({ text: "“", bold: true, size: 28, color: WARM, font: "Cambria" }),
            ],
          }),
        ],
      }),
    ]})],
  });
}

// Pack Fluidez Total — tarjeta de detalle del programa estrella.
// Solo se incluye en PDFs personalizados (con D.showPackFluidez=true).
function packFluidezBox() {
  const featureRow = (text) => new Paragraph({
    spacing: { after: 80, line: 300 },
    children: [
      new TextRun({ text: "✓  ", bold: true, size: 22, color: WARM_DARK, font: "Calibri" }),
      new TextRun({ text, size: 21, color: TEXT_DARK, font: "Calibri" }),
    ],
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders,
      shading: { fill: WARM_50, type: ShadingType.CLEAR },
      margins: { top: 400, bottom: 400, left: 400, right: 400 },
      width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({
            text: "NUESTRO PROGRAMA ESTRELLA",
            bold: true, size: 18, color: WARM_DARK, font: "Calibri", characterSpacing: 200,
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({
            text: "Pack Fluidez Total",
            bold: true, size: 40, color: NAVY, font: "Cambria",
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({
            text: "De cero a fluidez · 6 meses",
            italics: true, size: 24, color: TEXT_MUTED, font: "Cambria",
          })],
        }),
        featureRow("6 meses de formación inmersiva"),
        featureRow("96 sesiones grupales en vivo"),
        featureRow("Grupos pequeños (mínimo 4 alumnos)"),
        featureRow("Profesores nativos que hablan español"),
        featureRow("Diploma de finalización Aprender-Aleman.de"),
        featureRow("Garantía de devolución"),
        featureRow("Materiales incluidos"),
        featureRow("Acceso a SCHULE"),
        featureRow("Hans, profesor digital con IA"),
        blank(200),
        // Línea de precio destacado
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({
            text: "Ahorra 90 € con pago único",
            bold: true, size: 20, color: SUCCESS, font: "Calibri",
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [
            new TextRun({ text: "Pago único:  ", size: 22, color: TEXT_DARK, font: "Calibri" }),
            new TextRun({ text: "1.890 €", bold: true, size: 32, color: NAVY, font: "Cambria" }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Mensual:  ", size: 22, color: TEXT_DARK, font: "Calibri" }),
            new TextRun({ text: "330 €", bold: true, size: 26, color: NAVY, font: "Cambria" }),
            new TextRun({ text: "  × 6 meses", size: 22, color: TEXT_MUTED, font: "Calibri" }),
          ],
        }),
      ],
    })]})],
  });
}

// CTA box grande
function ctaBox() {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      borders: noBorders,
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 400, bottom: 400, left: 400, right: 400 },
      width: { size: 9360, type: WidthType.DXA },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [new TextRun({
            text: "¿LISTO PARA DAR EL SIGUIENTE PASO?",
            bold: true, size: 20, color: WARM, font: "Calibri", characterSpacing: 200,
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({
            text: "Reserva tu clase de prueba GRATIS",
            bold: true, size: 36, color: WHITE, font: "Cambria",
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 280, line: 320 },
          children: [new TextRun({
            text: "40 minutos con un profesor nativo alemán que habla español. Sin compromiso, sin sorpresas. Sales con un plan claro.",
            size: 22, color: NAVY_50, font: "Calibri", italics: true,
          })],
        }),
        // Botón visual
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          children: [new TextRun({
            text: "👉  b2c.aprender-aleman.de",
            bold: true, size: 28, color: WARM, font: "Calibri",
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: "Te respondemos en menos de 24 horas.",
            size: 19, color: NAVY_50, font: "Calibri", italics: true,
          })],
        }),
      ],
    })]})],
  });
}

// Header global
function pageHeader(level, pdfNumber, totalPdfs) {
  return new Header({
    children: [new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 4680],
      rows: [new TableRow({ children: [
        new TableCell({
          borders: noBorders, width: { size: 4680, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 0, right: 0 },
          children: [new Paragraph({
            children: [
              new ImageRun({
                type: "png", data: LOGO,
                transformation: { width: 20, height: 20 },
                altText: { title: "Aprender-Aleman", description: "Logo", name: "logo" },
              }),
              new TextRun({ text: "  Aprender-Aleman", bold: true, size: 17, color: NAVY, font: "Calibri" }),
              new TextRun({ text: ".de", bold: true, size: 17, color: WARM_DARK, font: "Calibri" }),
            ],
          })],
        }),
        new TableCell({
          borders: noBorders, width: { size: 4680, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 0, right: 0 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({
              text: `Guía ${pdfNumber} de ${totalPdfs}  ·  Nivel ${level}`,
              size: 16, color: TEXT_MUTED, font: "Calibri", characterSpacing: 60, bold: true,
            })],
          })],
        }),
      ]})],
    })],
  });
}

function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_SOFT, space: 6 } },
      children: [
        new TextRun({ text: "Aprender-Aleman", size: 15, color: NAVY, bold: true, font: "Calibri" }),
        new TextRun({ text: ".de", size: 15, color: WARM_DARK, bold: true, font: "Calibri" }),
        new TextRun({ text: "  ·  Tu academia online de alemán nativo  ·  ", size: 15, color: TEXT_MUTED, font: "Calibri" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 15, color: TEXT_MUTED, font: "Calibri", bold: true }),
        new TextRun({ text: "/5", size: 15, color: TEXT_MUTED, font: "Calibri", bold: true }),
      ],
    })],
  });
}

// ── Progress bar ────────────────────────────────────────────
function progressBar(currentN, totalN) {
  const cells = [];
  for (let i = 1; i <= totalN; i++) {
    cells.push(new TableCell({
      borders: noBorders,
      shading: { fill: i <= currentN ? WARM : NAVY_50, type: ShadingType.CLEAR },
      margins: { top: 0, bottom: 0, left: 80, right: 80 },
      width: { size: Math.floor(9360 / totalN), type: WidthType.DXA },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: `${i}`, bold: true, size: 18,
          color: i <= currentN ? NAVY : TEXT_MUTED,
          font: "Calibri",
        })],
      })],
    }));
  }
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: Array(totalN).fill(Math.floor(9360 / totalN)),
    rows: [new TableRow({
      height: { value: 520, rule: HeightRule.ATLEAST },
      children: cells,
    })],
  });
}

// ── BUILD DOCUMENT ──────────────────────────────────────────
function buildDoc(D) {
  const children = [];

  // ─── PÁGINA 1: PORTADA + INTRO ────────────────────────────
  children.push(
    eyebrow(`Guía ${D.pdfNumber}  ·  Nivel ${D.level}`, WARM_DARK, 100),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({
        text: D.title, bold: true, size: 56, color: NAVY, font: "Cambria",
      })],
    }),
    new Paragraph({
      spacing: { after: 320 },
      children: [new TextRun({
        text: D.subtitle, italics: true, size: 26, color: TEXT_MUTED, font: "Cambria",
      })],
    }),
    p(D.introText, { size: 22, color: TEXT_DARK, spacingAfter: 320, line: 320 }),
    blank(200),

    // Progress bar
    eyebrow("Tu progreso en la serie", WARM_DARK, 60),
    progressBar(D.pdfNumber, D.totalPdfs),
    blank(200),

    // En esta guía vas a aprender:
    eyebrow("En esta guía vas a llevarte"),
    new Paragraph({
      spacing: { after: 80, line: 320 },
      children: [
        new TextRun({ text: "✓  ", bold: true, size: 22, color: SUCCESS }),
        new TextRun({ text: "15 frases para saludar, presentarte y empezar conversaciones", size: 21, color: TEXT_DARK, font: "Calibri" }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80, line: 320 },
      children: [
        new TextRun({ text: "✓  ", bold: true, size: 22, color: SUCCESS }),
        new TextRun({ text: "Los 2 verbos más importantes del alemán: SEIN y HABEN", size: 21, color: TEXT_DARK, font: "Calibri" }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80, line: 320 },
      children: [
        new TextRun({ text: "✓  ", bold: true, size: 22, color: SUCCESS }),
        new TextRun({ text: "Un mini-diálogo real para hacerte una idea de cómo se habla", size: 21, color: TEXT_DARK, font: "Calibri" }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80, line: 320 },
      children: [
        new TextRun({ text: "✓  ", bold: true, size: 22, color: SUCCESS }),
        new TextRun({ text: "Los 3 errores típicos que cometen TODOS los hispanohablantes", size: 21, color: TEXT_DARK, font: "Calibri" }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ─── PÁGINA 2: VOCABULARIO ────────────────────────────────
  children.push(
    eyebrow("Sección 1  ·  Vocabulario práctico"),
    h1Serif(D.vocab.title, NAVY, 36),
    p("Estas frases las vas a oír (y a decir) desde el primer día en cualquier país de habla alemana. Memoriza primero las 5 que más uses.", {
      size: 21, color: TEXT_MUTED, italics: true, spacingAfter: 240,
    }),
    vocabTable(D.vocab.items),
    blank(280),
    trucoBox(D.vocab.truco),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ─── PÁGINA 3: GRAMÁTICA ──────────────────────────────────
  children.push(
    eyebrow("Sección 2  ·  Gramática esencial"),
    h1Serif(D.grammar.title, NAVY, 32),
    p(D.grammar.intro, { size: 21, color: TEXT_DARK, spacingAfter: 280, line: 320 }),
    conjugationTable(D.grammar.table),
    blank(280),
    p("Ejemplos rápidos:", { bold: true, size: 21, color: NAVY, spacingAfter: 120 }),
    ...D.grammar.examples.map(ex => new Paragraph({
      spacing: { after: 100, line: 300 },
      children: [
        new TextRun({ text: "›  ", bold: true, size: 22, color: WARM_DARK }),
        new TextRun({ text: ex, size: 21, color: NAVY, font: "Cambria", italics: true }),
      ],
    })),
    blank(200),
    claveEsBox(D.grammar.claveEs),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ─── PÁGINA 4: DIÁLOGO + ERRORES ──────────────────────────
  children.push(
    eyebrow("Sección 3  ·  Cómo suena de verdad"),
    h2Serif(D.dialogue.title, NAVY, 28),
    blank(120),
    dialogueBox(D.dialogue.title, D.dialogue.scenarioEs, D.dialogue.lines),
    blank(320),
    mistakesTable(D.mistakes),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ─── PÁGINA 5: TESTIMONIOS + (PACK opcional) + CTA ─────────
  children.push(
    eyebrow("Lo que dicen nuestros alumnos"),
    h1Serif("Esto no es teoría — funciona.", NAVY, 32),
    blank(200),
    testimonialCard(D.testimonials[0]),
    blank(180),
    testimonialCard(D.testimonials[1]),
    blank(180),
    testimonialCard(D.testimonials[2]),
    blank(320),
  );
  // PDFs personalizados (Cesar, etc) muestran el Pack Fluidez Total
  // detallado antes del CTA — es la propuesta concreta de conversión.
  if (D.showPackFluidez) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      eyebrow("Cómo lo logramos contigo"),
      h1Serif("El programa que te lleva ahí.", NAVY, 32),
      blank(200),
      packFluidezBox(),
      blank(320),
    );
  }
  children.push(ctaBox());

  return new Document({
    creator: "Aprender-Aleman.de",
    title: `${D.title} — Nivel ${D.level}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1100, right: 1200, bottom: 1000, left: 1200 },
        },
      },
      headers: { default: pageHeader(D.level, D.pdfNumber, D.totalPdfs) },
      footers: { default: pageFooter() },
      children,
    }],
  });
}

// ── PDF 2: A1.1 ────────────────────────────────────────────
const PDF2 = {
  level: "A1.1",
  pdfNumber: 2,
  totalPdfs: 7,
  title: "Hablar de ti y tu día a día",
  subtitle: "El presente que vas a usar mil veces",
  introText:
    "Una vez sabes saludar, el siguiente paso es contar quién eres y qué haces. Aquí tienes 15 frases para café, supermercado y trabajo, más los 5 verbos que conjugarás cada día en alemán.",

  vocab: {
    title: "Frases que escucharás cada día en Alemania",
    items: [
      { de: "Ich hätte gern einen Kaffee, bitte.", es: "Me gustaría un café, por favor." },
      { de: "Was kostet das?",                     es: "¿Cuánto cuesta?" },
      { de: "Können Sie bitte langsamer sprechen?",es: "¿Puede hablar más despacio?" },
      { de: "Ich nehme das hier.",                 es: "Me llevo esto." },
      { de: "Mit Karte oder bar?",                 es: "¿Con tarjeta o efectivo?" },
      { de: "Zusammen oder getrennt?",             es: "¿Junto o separado? (pagar)" },
      { de: "Ich arbeite als Designer.",           es: "Trabajo como diseñador." },
      { de: "Ich gehe zur Arbeit.",                es: "Voy al trabajo." },
      { de: "Ich lerne Deutsch seit 3 Monaten.",   es: "Estudio alemán desde hace 3 meses." },
      { de: "Wann fängt das Meeting an?",          es: "¿Cuándo empieza la reunión?" },
      { de: "Ich brauche eine Pause.",             es: "Necesito una pausa." },
      { de: "Was machst du heute Abend?",          es: "¿Qué haces esta noche?" },
      { de: "Ich habe keine Zeit.",                es: "No tengo tiempo." },
      { de: "Bis morgen!",                         es: "¡Hasta mañana!" },
      { de: "Einen schönen Tag noch!",             es: "¡Que tengas buen día!" },
    ],
    truco: "El „bitte“ es tu mejor amigo en Alemania. Úsalo SIEMPRE — no suena servil, suena educado. Es la diferencia entre que te ayuden con gusto o de mala gana.",
  },

  grammar: {
    title: "Presente regular: 5 verbos que conjugarás cada día",
    intro: "La buena noticia: la mayoría de verbos alemanes son REGULARES. Aprendes UNA terminación por persona y la aplicas a cientos de verbos. Aquí los 5 más usados.",
    table: [
      ["",                "machen (hacer)", "lernen (aprender)"],
      ["ich (yo)",        "mache",          "lerne"],
      ["du (tú)",         "machst",         "lernst"],
      ["er/sie (él/ella)","macht",          "lernt"],
      ["wir (nosotros)",  "machen",         "lernen"],
      ["ihr (vosotros)",  "macht",          "lernt"],
      ["sie/Sie",         "machen",         "lernen"],
    ],
    examples: [
      "Ich mache Sport.   →   Hago deporte.",
      "Du lernst schnell.   →   Aprendes rápido.",
      "Wir arbeiten in Berlin.   →   Trabajamos en Berlín.",
      "Was machst du heute?   →   ¿Qué haces hoy?",
    ],
    claveEs:
      "💡 Patrón de terminaciones: ich → -e, du → -st, er/sie → -t, wir/sie → -en, ihr → -t. Si memorizas esto, conjugas correctamente más de 1.000 verbos. La excepción son los irregulares (sein, haben, fahren, essen, sehen…) — pero eso lo trabajamos en la siguiente guía.",
  },

  dialogue: {
    title: "En la panadería de Múnich",
    scenarioEs: "Martes a las 8 de la mañana. Quieres desayunar antes del trabajo.",
    lines: [
      { s: "Verkäuferin", t: "Guten Morgen! Was darf es sein?" },
      { s: "Tú",          t: "Guten Morgen! Ich hätte gern zwei Brötchen und einen Kaffee, bitte." },
      { s: "Verkäuferin", t: "Mit Milch?" },
      { s: "Tú",          t: "Ja, gerne. Was kostet das zusammen?" },
      { s: "Verkäuferin", t: "Vier Euro fünfzig." },
      { s: "Tú",          t: "Hier, bitte. Einen schönen Tag noch!" },
    ],
  },

  mistakes: [
    {
      wrong: "Ich gehe heute zur Arbeit.",
      right: "Heute gehe ich zur Arbeit.   (cuando „heute“ va al inicio)",
      why:   "Si pones „heute“ al inicio para enfatizarlo, el verbo („gehe“) DEBE ir inmediatamente después, y el sujeto („ich“) queda detrás. Es la regla del verbo en 2ª posición.",
    },
    {
      wrong: "Du machts.",
      right: "Du machst.",
      why:   "La terminación para „du“ es -ST, no -TS. Memoriza el orden: -e, -st, -t, -en, -t, -en.",
    },
    {
      wrong: "Was du machst heute?",
      right: "Was machst du heute?",
      why:   "En preguntas con W-palabra (was, wann, wo…), el verbo va EN SEGUNDO LUGAR, justo después de la W-palabra. El sujeto va detrás.",
    },
  ],

  testimonials: [
    {
      name: "Ana V.", city: "Buenos Aires · 26 años",
      levelStart: "A0", levelNow: "A2",
      text: "A los 4 meses ya pedía café y daba conversación en Berlín. ¡Mi profesora es paciencia pura!",
    },
    {
      name: "Diego F.", city: "Lima · 45 años",
      levelStart: "A0", levelNow: "A2",
      text: "Pasé 2 años intentando con apps y videos de YouTube. Avanzaba poco y sin saber si estaba bien. En 3 meses con profesor nativo aprendí más que en todo ese tiempo. La diferencia es tener alguien que te corrija en vivo.",
    },
    {
      name: "Lucía B.", city: "Madrid · 31 años",
      levelStart: "A0", levelNow: "B1",
      text: "Mi suegra alemana ya no me habla en inglés. Para mí, esa es la mejor nota.",
    },
  ],
};

// ── PDF 3: A1.2 ────────────────────────────────────────────
const PDF3 = {
  level: "A1.2",
  pdfNumber: 3,
  totalPdfs: 7,
  title: "Formar frases y hacer preguntas",
  subtitle: "El secreto del orden alemán de las palabras",
  introText:
    "Esta es la guía que muchos alumnos describen como „el momento en que todo encajó“. Vas a entender la regla más importante del alemán y vas a aprender a hacer cualquier pregunta. Sí, cualquiera.",

  vocab: {
    title: "12 preguntas que te sacan de cualquier apuro",
    items: [
      { de: "Wo ist die Toilette?",       es: "¿Dónde está el baño?" },
      { de: "Wie viel kostet das?",       es: "¿Cuánto cuesta esto?" },
      { de: "Wann kommt der Bus?",        es: "¿Cuándo viene el autobús?" },
      { de: "Was bedeutet das?",          es: "¿Qué significa eso?" },
      { de: "Warum nicht?",               es: "¿Por qué no?" },
      { de: "Wie heißt das auf Deutsch?", es: "¿Cómo se llama esto en alemán?" },
      { de: "Können Sie mir helfen?",     es: "¿Puede ayudarme?" },
      { de: "Verstehen Sie Englisch?",    es: "¿Entiende inglés?" },
      { de: "Haben Sie ein Zimmer frei?", es: "¿Tiene una habitación libre?" },
      { de: "Wo finde ich…?",             es: "¿Dónde encuentro…?" },
      { de: "Gibt es hier WLAN?",         es: "¿Hay WiFi aquí?" },
      { de: "Können Sie das wiederholen?",es: "¿Puede repetir?" },
    ],
    truco: "Memorízate las W-palabras: Wer (quién), Was (qué), Wo (dónde), Wann (cuándo), Warum (por qué), Wie (cómo), Wie viel (cuánto). Con estas 7 y un verbo, formas cualquier pregunta del mundo.",
  },

  grammar: {
    title: "Las 2 formas de hacer preguntas en alemán",
    intro: "El alemán tiene SOLO 2 tipos de preguntas. Una vez los dominas, jamás te quedas sin saber cómo preguntar algo.",
    table: [
      ["",                 "PREGUNTA SÍ/NO",                  "PREGUNTA CON W-"],
      ["Estructura",       "Verbo + Sujeto + …?",             "W- + Verbo + Sujeto + …?"],
      ["Ejemplo 1",        "Sprichst du Deutsch?",            "Was sprichst du?"],
      ["Ejemplo 2",        "Hast du Zeit?",                    "Wann hast du Zeit?"],
      ["Ejemplo 3",        "Kommst du mit?",                   "Wohin kommst du?"],
      ["Respuesta típica", "Ja / Nein / Doch",                 "Frase completa"],
    ],
    examples: [
      "Sprichst du Spanisch?   →   ¿Hablas español?   (Verbo + sujeto)",
      "Was machst du?   →   ¿Qué haces?   (W- + verbo + sujeto)",
      "Hast du WhatsApp?   →   ¿Tienes WhatsApp?",
      "Wo wohnst du?   →   ¿Dónde vives?",
    ],
    claveEs:
      "💡 Truco infalible: si tu pregunta empieza con „qué/dónde/cuándo“ → W-palabra primero, verbo segundo. Si tu pregunta es de „sí o no“ → verbo primero, sujeto segundo. Funciona el 100% de las veces. Y „doch“ es una palabra mágica que no existe en español: úsala para responder „sí“ a una pregunta negativa („¿No tienes hambre?“ → „Doch, claro que tengo!“).",
  },

  dialogue: {
    title: "Perdido en Berlín — pidiendo indicaciones",
    scenarioEs: "Buscas la estación de Alexanderplatz y le preguntas a una berlinesa en plena calle.",
    lines: [
      { s: "Tú",       t: "Entschuldigung, wo ist die U-Bahn?" },
      { s: "Berlinesa",t: "Welche Linie suchst du?" },
      { s: "Tú",       t: "U2, nach Alexanderplatz." },
      { s: "Berlinesa",t: "Gehst du geradeaus 200 Meter. Dann rechts." },
      { s: "Tú",       t: "Wie lange dauert es zu Fuß?" },
      { s: "Berlinesa",t: "Etwa 5 Minuten. Brauchst du noch was?" },
      { s: "Tú",       t: "Nein, vielen Dank! Du hast mir sehr geholfen." },
    ],
  },

  mistakes: [
    {
      wrong: "Du hast WhatsApp?",
      right: "Hast du WhatsApp?",
      why:   "En preguntas Sí/No el verbo va PRIMERO. Sin invertir parece una afirmación con tono raro. Esta inversión es la marca distintiva del idioma alemán.",
    },
    {
      wrong: "Was du machst heute?",
      right: "Was machst du heute?",
      why:   "Tras la W-palabra, el verbo va inmediatamente. El sujeto („du“) viene después. Es el mismo patrón que en afirmaciones: el verbo siempre en 2ª posición.",
    },
    {
      wrong: "¿Hast du nicht Hunger?  →  Ja.   (querer decir „sí, tengo“)",
      right: "Hast du keinen Hunger?  →  DOCH! Ich habe Hunger.",
      why:   "Si respondes „ja“ a una pregunta negativa, confirmas la negación („tienes razón, no tengo hambre“). Para contradecir y decir „sí“ → usa „DOCH“. Es una palabra exclusiva del alemán.",
    },
  ],

  testimonials: [
    {
      name: "Javier H.", city: "Bogotá · 38 años",
      levelStart: "A0", levelNow: "A2",
      text: "Antes evitaba hablar por miedo a equivocarme. Ahora formo frases sin pensar y disfruto cada conversación.",
    },
    {
      name: "Elena G.", city: "Barcelona · 27 años",
      levelStart: "A1", levelNow: "B1",
      text: "Conocí a mi pareja alemana hablando de Tatort. ¡Gracias a las clases!",
    },
    {
      name: "Miguel Á.", city: "Ciudad de México · 33 años",
      levelStart: "A0", levelNow: "B1",
      text: "Pasé una entrevista entera en alemán para una startup en Berlín. Cuando me ofrecieron el puesto la HR-Managerin me dijo: „Tu alemán es realmente bueno para alguien que aprende online“. Era exactamente lo que necesitaba escuchar.",
    },
  ],
};

// ── PDF 4: A2.1 ────────────────────────────────────────────
const PDF4 = {
  level: "A2.1",
  pdfNumber: 4,
  totalPdfs: 7,
  title: "Hablar del pasado: el Perfekt",
  subtitle: "Cuenta tu fin de semana, tu día, tu vida",
  introText:
    "El Perfekt es el pasado que los alemanes usan al hablar — sí, también para acciones de hace 10 años. Es más fácil de lo que parece: una vez memorices unos cuantos Partizipien, ya estás contando historias enteras en alemán.",

  vocab: {
    title: "12 Partizipien que vas a necesitar siempre",
    items: [
      { de: "gemacht",     es: "hecho   (de machen)" },
      { de: "gegangen",    es: "ido   (de gehen — con sein)" },
      { de: "gekommen",    es: "venido   (de kommen — con sein)" },
      { de: "gesehen",     es: "visto   (de sehen)" },
      { de: "gegessen",    es: "comido   (de essen)" },
      { de: "getrunken",   es: "bebido   (de trinken)" },
      { de: "gefahren",    es: "ido (en vehículo)   (con sein)" },
      { de: "gelesen",     es: "leído   (de lesen)" },
      { de: "geschrieben", es: "escrito   (de schreiben)" },
      { de: "gewesen",     es: "estado/sido   (de sein — con sein)" },
      { de: "gehabt",      es: "tenido   (de haben)" },
      { de: "gearbeitet",  es: "trabajado   (de arbeiten — con -et)" },
    ],
    truco: "Casi todos los Partizipien empiezan con „ge-“ y acaban en „-t“ (regular) o „-en“ (irregular). Excepciones: verbos en „-ieren“ no llevan „ge-“ (telefoniert, studiert).",
  },

  grammar: {
    title: "Perfekt: haben/sein + Partizip II al FINAL",
    intro: "El Perfekt tiene una sola estructura. La parte difícil es saber si va con HABEN o SEIN, y memorizar los participios irregulares. Pero el orden es siempre el mismo.",
    table: [
      ["",                  "PERFEKT con HABEN",            "PERFEKT con SEIN"],
      ["Cuándo",            "La mayoría de verbos",         "Movimiento + cambio de estado"],
      ["Estructura",        "haben + … + Partizip II",      "sein + … + Partizip II"],
      ["Ejemplo 1",         "Ich habe gegessen.",            "Ich bin gegangen."],
      ["Ejemplo 2",         "Du hast gesehen.",              "Du bist gekommen."],
      ["Ejemplo 3",         "Wir haben gearbeitet.",         "Wir sind gefahren."],
      ["Verbos clave SEIN", "—",                             "gehen, kommen, fahren, fliegen, laufen, bleiben, sein, werden"],
    ],
    examples: [
      "Ich habe Pizza gegessen.   →   He comido pizza.",
      "Wir sind nach Berlin gefahren.   →   Hemos ido a Berlín.",
      "Hast du das Buch gelesen?   →   ¿Has leído el libro?",
      "Sie ist nicht gekommen.   →   Ella no ha venido.",
    ],
    claveEs:
      "💡 Regla de oro: HABEN para casi todo (he comido, he visto, he hecho). SEIN solo cuando te mueves o cambias (he ido, he venido, he sido, me he dormido). La frase TERMINA con el Partizip II — siempre. Memoriza 20 Partizipien y ya hablas del pasado como un alemán.",
  },

  dialogue: {
    title: "Lunes en la oficina — el clásico „cómo te fue el finde“",
    scenarioEs: "Llegas a la oficina con cara de poco dormir. Tu colega Anna te pregunta cómo te fue.",
    lines: [
      { s: "Anna",  t: "Hallo Sofia! Wie war dein Wochenende?" },
      { s: "Sofia", t: "Super! Am Samstag bin ich mit Freunden ins Kino gegangen." },
      { s: "Anna",  t: "Cool! Was habt ihr gesehen?" },
      { s: "Sofia", t: "Den neuen Tarantino-Film. Wir haben danach Pizza gegessen." },
      { s: "Anna",  t: "Und am Sonntag?" },
      { s: "Sofia", t: "Ich habe lange geschlafen und einen Krimi gelesen. Perfekt." },
    ],
  },

  mistakes: [
    {
      wrong: "Ich habe gegangen ins Kino.",
      right: "Ich BIN ins Kino gegangen.",
      why:   "„Gehen“ es verbo de movimiento → siempre con SEIN, no con HABEN. Memoriza: gehen, kommen, fahren, fliegen, laufen, schwimmen — todos con SEIN.",
    },
    {
      wrong: "Ich habe gegessen Pizza gestern.",
      right: "Ich habe gestern Pizza gegessen.",
      why:   "El Partizip II („gegessen“) va siempre al FINAL de la frase. Sin excepción. Es como una caja de paréntesis: haben/sein abre, Partizip cierra.",
    },
    {
      wrong: "Ich habe telegefoniert.",
      right: "Ich habe telefoniert.   (sin „ge-“)",
      why:   "Los verbos terminados en „-ieren“ NO llevan „ge-“ en el Partizip: telefoniert, studiert, fotografiert, organisiert. Es la única excepción importante.",
    },
  ],

  testimonials: [
    {
      name: "Pablo R.", city: "Bogotá · 41 años",
      levelStart: "A0", levelNow: "B1",
      text: "Soy ingeniero y siempre fui de aprender solo. Pero el alemán me ganó. Después de 2 años perdidos con apps probé una clase con un profesor de aquí. A las 6 semanas ya contaba mi fin de semana en Perfekt sin pensarlo. La calidad de la enseñanza marca la diferencia.",
    },
    {
      name: "Laura M.", city: "Asunción · 28 años",
      levelStart: "A1", levelNow: "A2",
      text: "Por fin entiendo el pasado alemán. Antes era un caos en mi cabeza.",
    },
    {
      name: "Ricardo S.", city: "Caracas · 36 años",
      levelStart: "A0", levelNow: "B1",
      text: "Vivo en Hamburgo desde hace 1 año. Las clases me sacaron del „puro inglés“ que paraliza tanto a los inmigrantes.",
    },
  ],
};

// ── PDF 5: A2.2 ────────────────────────────────────────────
const PDF5 = {
  level: "A2.2",
  pdfNumber: 5,
  totalPdfs: 7,
  title: "Planes y obligaciones: modales + futuro",
  subtitle: "Habla del mañana como si ya viviera ahí",
  introText:
    "Los verbos modales (können, müssen, wollen…) son la herramienta que multiplica por 10 lo que puedes decir. Y el futuro alemán tiene un truco: muchas veces ni siquiera lo necesitas. Aquí te explico cómo hacerlo bien.",

  vocab: {
    title: "12 frases para planes, deseos y obligaciones",
    items: [
      { de: "Ich muss um 7 aufstehen.",        es: "Tengo que levantarme a las 7." },
      { de: "Kannst du mir helfen?",           es: "¿Puedes ayudarme?" },
      { de: "Ich will Deutsch lernen.",        es: "Quiero aprender alemán." },
      { de: "Ich möchte einen Kaffee.",        es: "Me gustaría un café. (cortés)" },
      { de: "Darf ich rein?",                   es: "¿Puedo entrar? (permiso)" },
      { de: "Ich soll früher kommen.",         es: "Debo venir antes. (porque me lo dijeron)" },
      { de: "Morgen fliege ich nach Berlin.",  es: "Mañana vuelo a Berlín." },
      { de: "Was machst du am Wochenende?",    es: "¿Qué haces el fin de semana?" },
      { de: "Ich werde dich anrufen.",          es: "Te voy a llamar." },
      { de: "Können wir uns treffen?",          es: "¿Podemos vernos?" },
      { de: "Ich muss noch arbeiten.",         es: "Aún tengo que trabajar." },
      { de: "Wollen wir gehen?",                es: "¿Vamos? (literalmente: ¿queremos ir?)" },
    ],
    truco: "Para futuros cercanos los alemanes usan PRESENTE con un adverbio: „Morgen FAHRE ich“ (mañana voy). Suena más natural que „werde fahren“. Reserva „werden“ para anuncios formales o promesas.",
  },

  grammar: {
    title: "Modalverben + werden: dos construcciones, una regla",
    intro: "Ambas funcionan igual: el verbo conjugado va en 2ª posición y el verbo principal en INFINITIVO al FINAL. Es la famosa Satzklammer (paréntesis verbal) del alemán.",
    table: [
      ["",                   "MODALVERBEN",                  "FUTUR I con werden"],
      ["Conjuga",            "können / müssen / wollen / möchten / dürfen / sollen", "werden"],
      ["Cuándo",             "Capacidad, obligación, deseo, permiso", "Futuro lejano o promesa formal"],
      ["Estructura",         "Modal + … + Infinitiv",        "werden + … + Infinitiv"],
      ["Ejemplo",            "Ich KANN gut Pizza essen.",    "Ich WERDE dich anrufen."],
      ["Tip",                "Aprende los 6 modales primero","En oral, usa presente para futuro cercano"],
    ],
    examples: [
      "Ich muss arbeiten.   →   Tengo que trabajar.",
      "Wir wollen ins Kino gehen.   →   Queremos ir al cine.",
      "Können Sie das wiederholen?   →   ¿Puede repetir?",
      "Ich werde morgen kommen.   →   Vendré mañana.",
    ],
    claveEs:
      "💡 Estructura clave (Satzklammer): el primer verbo conjugado abre el paréntesis y el infinitivo lo cierra al final. Ejemplo: „Ich KANN [Pizza essen]“. La frase entera „pizza essen“ está dentro del paréntesis. Esto es lo más distintivo del alemán — domínalo y suena nativo.",
  },

  dialogue: {
    title: "Planeando una escapada con un amigo",
    scenarioEs: "Viernes por la tarde. Tu amigo Tom te escribe por WhatsApp para hacer un plan.",
    lines: [
      { s: "Tom",   t: "Sofia, was machst du am Wochenende?" },
      { s: "Sofia", t: "Noch nichts. Wollen wir was machen?" },
      { s: "Tom",   t: "Ich will nach Potsdam fahren. Kommst du mit?" },
      { s: "Sofia", t: "Klar! Wann müssen wir los?" },
      { s: "Tom",   t: "Am Samstag um 9. Wir werden den ganzen Tag dort sein." },
      { s: "Sofia", t: "Perfekt. Ich kann das Auto nehmen." },
    ],
  },

  mistakes: [
    {
      wrong: "Ich kann sprechen Deutsch.",
      right: "Ich kann Deutsch sprechen.",
      why:   "El infinitivo („sprechen“) va siempre al FINAL en frases con modalverb. Es la regla de la Satzklammer — no se rompe nunca.",
    },
    {
      wrong: "Ich will ein Bier, bitte.",
      right: "Ich möchte ein Bier, bitte.",
      why:   "„Wollen“ suena exigente al pedir. En contextos de servicio (camarero, tienda) usa SIEMPRE „möchten“ con „bitte“. Es la versión cortés y la única aceptable en alemán comercial.",
    },
    {
      wrong: "Morgen ich werde nach Berlin fahren.",
      right: "Morgen werde ich nach Berlin fahren.   /   Morgen fahre ich nach Berlin.",
      why:   "Si „morgen“ va al inicio, el verbo („werde“ o „fahre“) DEBE ir inmediatamente después, y el sujeto detrás. La regla del verbo en 2ª posición no se rompe nunca.",
    },
  ],

  testimonials: [
    {
      name: "Andrea L.", city: "Santiago · 32 años",
      levelStart: "A0", levelNow: "B1",
      text: "Conseguí el ascenso porque podía atender clientes alemanes sin traductor. El responsable me dijo claramente que mi alemán fue decisivo. Empecé en A0 hace 8 meses con esta academia, y hoy en cada reunión me siento segura.",
    },
    {
      name: "David T.", city: "Montevideo · 25 años",
      levelStart: "A1", levelNow: "A2",
      text: "Pedir lo que quiero en un restaurante en Berlín ya no es traumático. Es libertad pura.",
    },
    {
      name: "Patricia O.", city: "Asunción · 40 años",
      levelStart: "A0", levelNow: "B1",
      text: "Intercambio académico en Berlín conseguido. Sin las clases hubiera sido imposible — me ayudaron desde la solicitud hasta la entrevista.",
    },
  ],
};

// ── PDF 6: B1 ────────────────────────────────────────────
const PDF6 = {
  level: "B1",
  pdfNumber: 6,
  totalPdfs: 7,
  title: "Da tu opinión: el subjuntivo II (Konjunktiv II)",
  subtitle: "Suena culto, opinas con peso, debates como local",
  introText:
    "En B1 dejas de „sobrevivir“ y empiezas a EXPRESARTE. El Konjunktiv II („würde + Infinitiv“, „könnte“, „hätte“, „wäre“) es la herramienta clave: sirve para opinar con educación, dar consejos, hablar de hipótesis y sonar como un nativo culto. Domínalo y dejas la zona de „guiri“ para entrar a la zona de „este habla bien“.",

  vocab: {
    title: "12 frases de opinión, hipótesis y consejo",
    items: [
      { de: "Ich würde sagen, dass…",                es: "Yo diría que… (opinar suave)" },
      { de: "An deiner Stelle würde ich…",            es: "En tu lugar yo…" },
      { de: "Es wäre besser, wenn…",                  es: "Sería mejor que…" },
      { de: "Ich hätte eine Frage.",                  es: "Tendría una pregunta. (cortés)" },
      { de: "Könntest du mir helfen?",                es: "¿Podrías ayudarme?" },
      { de: "Meiner Meinung nach…",                   es: "En mi opinión…" },
      { de: "Ich bin der Meinung, dass…",             es: "Opino que…" },
      { de: "Einerseits… andererseits…",              es: "Por un lado… por otro…" },
      { de: "Das hängt davon ab.",                    es: "Eso depende." },
      { de: "Stimmt, aber…",                          es: "Cierto, pero…" },
      { de: "Da bin ich anderer Meinung.",            es: "Ahí pienso diferente." },
      { de: "Wenn ich Zeit hätte, würde ich reisen.", es: "Si tuviera tiempo, viajaría." },
    ],
    truco: "El truco para no liarte: en el 95% de los casos usa „würde + Infinitiv“ (würde sagen, würde gehen, würde machen). Solo memoriza las formas „cortas“ de los verbos más comunes: wäre, hätte, könnte, müsste, sollte, wüsste. Con eso ya cubres toda la conversación adulta.",
  },

  grammar: {
    title: "Konjunktiv II: hipótesis, cortesía y consejo",
    intro: "Es el „modo subjuntivo“ del alemán. Lo usas para 3 cosas: opinar/debatir con educación, hablar de cosas irreales („si tuviera dinero, viajaría“) y pedir cosas con cortesía. Estructura: igual que el indicativo, pero el verbo cambia de forma.",
    table: [
      ["",                "Indicativo (real)",         "Konjunktiv II (hipotético / cortés)"],
      ["sein",            "ich bin",                   "ich wäre"],
      ["haben",           "ich habe",                  "ich hätte"],
      ["können",          "ich kann",                  "ich könnte"],
      ["werden + Inf.",   "ich werde gehen",           "ich würde gehen"],
      ["Petición cortés", "Kannst du mir helfen?",     "Könntest du mir helfen?"],
      ["Hipótesis (si…)", "Wenn ich Zeit habe, gehe.", "Wenn ich Zeit hätte, würde ich gehen."],
    ],
    examples: [
      "Ich würde gerne mitkommen.   →   Me gustaría ir contigo.",
      "Hätten Sie einen Moment?   →   ¿Tendría un momento? (formal)",
      "Wenn ich du wäre, würde ich es machen.   →   Si yo fuera tú, lo haría.",
      "Das könnte ein Problem sein.   →   Eso podría ser un problema.",
    ],
    claveEs:
      "💡 Regla de oro para B1: si dudas, usa „würde + Infinitiv“. Es el comodín del Konjunktiv II — funciona con casi todos los verbos y suena natural. Solo SEIN, HABEN, los 6 modales y unos pocos más usan la forma corta (wäre, hätte, könnte). Lo demás: würde + verbo. Listo.",
  },

  dialogue: {
    title: "Debate con un colega sobre teletrabajo",
    scenarioEs: "Almuerzo en la oficina. Tu colega Markus suelta una opinión fuerte sobre el home-office. Tú no estás del todo de acuerdo.",
    lines: [
      { s: "Markus", t: "Ich finde, alle sollten wieder ins Büro kommen." },
      { s: "Sofia",  t: "Da bin ich anderer Meinung. Meiner Meinung nach ist Home-Office produktiver." },
      { s: "Markus", t: "Ja, aber das Team-Gefühl leidet darunter." },
      { s: "Sofia",  t: "Stimmt, aber an deiner Stelle würde ich einen Mix vorschlagen — 3 Tage Büro, 2 zu Hause." },
      { s: "Markus", t: "Hmm, das könnte funktionieren. Hättest du nicht Lust, das dem Chef zu sagen?" },
      { s: "Sofia",  t: "Wenn ich Zeit hätte, würde ich es gerne machen. Nächste Woche vielleicht." },
    ],
  },

  mistakes: [
    {
      wrong: "Ich würde wäre froh.",
      right: "Ich wäre froh.   (no se mezcla würde con wäre)",
      why:   "Las formas cortas (wäre, hätte, könnte, müsste) YA son subjuntivo. No las cubras con „würde“. Es como decir „yo sería estaría“ en español — redundante y mal.",
    },
    {
      wrong: "An deine Stelle würde ich gehen.",
      right: "An deinER Stelle würde ich gehen.",
      why:   "Frase fija: „an + DATIV“. „Stelle“ es femenino → „an der Stelle“ → con „deine“ → „an deiner Stelle“. Memorízala como bloque, te ahorrarás 100 errores.",
    },
    {
      wrong: "Ich finde es wäre besser.",
      right: "Ich finde, ES wäre besser.   (coma + sujeto explícito tras „dass“-frase)",
      why:   "En alemán formal escrito SIEMPRE sujeto + verbo conjugado. Y la coma antes de la subordinada es obligatoria. „Ich finde, dass es besser wäre“ es la versión más segura para B1.",
    },
  ],

  testimonials: [
    {
      name: "Carolina V.", city: "Frankfurt · 34 años",
      levelStart: "A1", levelNow: "B2",
      text: "Pasé de „entiendo el menú“ a poder dar mi opinión en reuniones del trabajo en menos de 1 año. Konjunktiv II fue el clic — antes era la callada del grupo, ahora la gente pide mi punto de vista. Esta academia me cambió la carrera.",
    },
    {
      name: "Sebastián G.", city: "Buenos Aires · 31 años",
      levelStart: "B1", levelNow: "B1+",
      text: "El profe me hizo perder el miedo a opinar. Ahora discuto política en alemán y disfruto.",
    },
    {
      name: "Marina P.", city: "Berlín · 38 años",
      levelStart: "A2", levelNow: "B1",
      text: "Aprobé el examen B1 en el primer intento. Las clases enfocadas en oral fueron decisivas — el Konjunktiv II ya me salía solo.",
    },
  ],
};

// ── PDF 7: B2 ────────────────────────────────────────────
const PDF7 = {
  level: "B2",
  pdfNumber: 7,
  totalPdfs: 7,
  title: "Argumenta y convence: pasiva + conectores complejos",
  subtitle: "Habla como en una conferencia o un examen Goethe B2",
  introText:
    "En B2 ya no se trata de SOBREVIVIR ni siquiera de EXPRESARTE — se trata de ARGUMENTAR. La voz pasiva („wird gemacht“) y los conectores avanzados („obwohl, trotzdem, allerdings“) son lo que distingue al hablante intermedio del avanzado. Aquí aprendes el arsenal completo para sonar con autoridad en alemán culto.",

  vocab: {
    title: "12 conectores que multiplican tu nivel oral",
    items: [
      { de: "obwohl…",                     es: "aunque… (subordinante)" },
      { de: "trotzdem,…",                  es: "a pesar de eso,…" },
      { de: "allerdings,…",                es: "sin embargo,… (matiz culto)" },
      { de: "deshalb / deswegen,…",        es: "por eso,…" },
      { de: "während…",                    es: "mientras… (contraste o tiempo)" },
      { de: "anstatt zu + Infinitiv",      es: "en lugar de + infinitivo" },
      { de: "sowohl… als auch…",           es: "tanto… como…" },
      { de: "weder… noch…",                es: "ni… ni…" },
      { de: "einerseits… andererseits…",   es: "por un lado… por otro…" },
      { de: "je… desto…",                  es: "cuanto más… más…" },
      { de: "nicht nur… sondern auch…",    es: "no solo… sino también…" },
      { de: "infolgedessen,…",             es: "en consecuencia,… (muy formal)" },
    ],
    truco: "Para subir de tono académico, sustituye „aber“ por „allerdings“ o „jedoch“ y „weil“ por „da“. Mismo significado, sonido mucho más maduro. En examen Goethe esto te sube nota directamente.",
  },

  grammar: {
    title: "Passiv (voz pasiva): „werden + Partizip II“",
    intro: "La pasiva es lo que separa textos B1 de textos B2. Sirve para describir procesos, dar formalidad y desviar el foco del actor („se hace X“ en vez de „yo hago X“). Es 100% gramatical, no opcional en escritura culta.",
    table: [
      ["",                "ACTIVA",                          "PASIVA (Vorgangspassiv)"],
      ["Foco",            "El actor / sujeto",               "La acción / el objeto"],
      ["Estructura",      "Sujeto + verbo + objeto",         "Objeto → sujeto + werden + Partizip II"],
      ["Presente",        "Man macht das.",                   "Das wird gemacht."],
      ["Pasado (Prät.)",  "Man machte das.",                  "Das wurde gemacht."],
      ["Perfekt",         "Man hat das gemacht.",             "Das ist gemacht worden."],
      ["Con modal",       "Man muss das machen.",             "Das muss gemacht werden."],
    ],
    examples: [
      "Das Haus wird renoviert.   →   La casa está siendo renovada.",
      "Der Brief wurde gestern geschrieben.   →   La carta fue escrita ayer.",
      "Die Regeln müssen respektiert werden.   →   Las reglas deben ser respetadas.",
      "Es ist viel gemacht worden.   →   Se ha hecho mucho.",
    ],
    claveEs:
      "💡 Truco clave B2: cada vez que pienses „se hace X“, „se dice Y“, „hay que…“, „uno debería…“ → en alemán cambia a PASIVA („wird gemacht“, „muss gemacht werden“). Suena infinitamente más natural que „man + verbo“ en textos escritos. En oral, usa „man“ libremente; en escritura formal y examen, PASIVA.",
  },

  dialogue: {
    title: "Reunión de proyecto — propones un cambio",
    scenarioEs: "Reunión del equipo. El jefe presenta el plan y abre la palabra. Tú quieres proponer una mejora SIN sonar agresiva.",
    lines: [
      { s: "Chef",  t: "Also, der Plan steht fest. Hat noch jemand etwas zu sagen?" },
      { s: "Sofia", t: "Allerdings möchte ich anmerken: obwohl der Plan gut durchdacht ist, gibt es einen Punkt." },
      { s: "Chef",  t: "Bitte." },
      { s: "Sofia", t: "Die Deadline ist sehr eng. Anstatt alles in einer Phase zu machen, könnte das Projekt in zwei Phasen geteilt werden." },
      { s: "Chef",  t: "Interessant. Und welcher Vorteil würde dadurch entstehen?" },
      { s: "Sofia", t: "Je früher Phase 1 abgeschlossen wird, desto schneller bekommen wir Feedback. Sowohl die Qualität als auch das Tempo würden verbessert werden." },
    ],
  },

  mistakes: [
    {
      wrong: "Trotzdem ich müde war, ich bin gegangen.",
      right: "Obwohl ich müde war, bin ich gegangen.   /   Ich war müde. Trotzdem bin ich gegangen.",
      why:   "„Trotzdem“ es un adverbio (no une frases) y „obwohl“ es subordinante (manda el verbo al final). Confusión clásica B1→B2. Memoriza: obwohl + verbo al final; trotzdem + inversión de sujeto+verbo.",
    },
    {
      wrong: "Das Buch ist gelesen.",
      right: "Das Buch wird gelesen.   (pasiva de proceso)   /   Das Buch ist gelesen worden.   (pasiva en Perfekt)",
      why:   "„Ist gelesen“ es Zustandspassiv (estado: el libro está leído, terminado). „Wird gelesen“ es Vorgangspassiv (proceso: se está leyendo). En el 90% de los contextos B2 quieres el Vorgangspassiv. Confúndelos y la frase suena rara.",
    },
    {
      wrong: "Je mehr ich lerne, desto ich verstehe mehr.",
      right: "Je mehr ich lerne, desto MEHR VERSTEHE ich.   (en la 2ª parte: comparativo + verbo + sujeto)",
      why:   "Estructura fija „je… desto…“: la 1ª parte es subordinada (verbo al final), la 2ª es principal con INVERSIÓN — el comparativo („desto mehr“) ocupa la 1ª posición, así que verbo en 2ª, sujeto en 3ª. Es muy típica en oral y escrito formal.",
    },
  ],

  testimonials: [
    {
      name: "Mariana C.", city: "Múnich · 35 años",
      levelStart: "B1", levelNow: "C1",
      text: "Aprobé el examen Goethe B2 con 92% al cabo de 10 meses con la academia. Era la barrera para conseguir el trabajo en BMW y ahora soy ingeniera de producto allí. Sin el enfoque en pasiva y conectores avanzados habría suspendido el oral. Lo recomiendo cerrado.",
    },
    {
      name: "Federico R.", city: "Zúrich · 42 años",
      levelStart: "B1", levelNow: "B2",
      text: "Cliente alemán me dijo: „du klingst sehr eloquent“. Antes le tenía pánico a hablar — ahora le doy yo el discurso de cierre.",
    },
    {
      name: "Isabella M.", city: "Hamburgo · 29 años",
      levelStart: "A2", levelNow: "B2",
      text: "De A2 a B2 en 14 meses. Hoy doy clases de yoga en alemán a alumnos nativos. La academia me dio la confianza que faltaba.",
    },
  ],
};

// ── PDF personalizado para César ────────────────────────────
// Lead que acaba de hacer clase de prueba A1, ecuatoriano, quiere
// trabajar en ciberseguridad en Alemania, su hermano ya vive allá.
// Mismo formato 5-pp + testimonio nuevo del Pack Fluidez Total.
const PDF_CESAR = {
  level: "A1 · para César",
  pdfNumber: 1,
  totalPdfs: 1,
  title: "Hola César — primeros pasos hacia Alemania",
  // Subtitle + intro vacíos a petición de Gelfis (PDF más directo).
  subtitle: "",
  introText: "",
  // Bandera para que buildDoc inserte la tarjeta del Pack Fluidez
  // Total entre los testimonios y el CTA final (solo en este PDF).
  showPackFluidez: true,

  vocab: {
    title: "Frases imprescindibles — tu hermano + tu trabajo",
    items: [
      { de: "Hey Bruder, was geht ab?",                          es: "Hey hermano, ¿qué pasa?  (informal, perfecto para tu hermano)" },
      { de: "Ich lerne Deutsch und ich komme nach Deutschland!", es: "¡Estoy aprendiendo alemán y me voy a Alemania!" },
      { de: "Ich heiße César und ich komme aus Ecuador.",        es: "Me llamo César y vengo de Ecuador." },
      { de: "Ich suche Arbeit in Cybersicherheit.",              es: "Busco trabajo en ciberseguridad." },
      { de: "Ich habe Erfahrung mit IT und Sicherheit.",         es: "Tengo experiencia en IT y seguridad." },
      { de: "Ich spreche Spanisch, Englisch und ein bisschen Deutsch.", es: "Hablo español, inglés y un poco de alemán." },
      { de: "Können Sie das wiederholen, bitte?",                es: "¿Puede repetir, por favor?  (en entrevistas)" },
      { de: "Ich verstehe nicht. Können Sie langsamer sprechen?", es: "No entiendo. ¿Puede hablar más despacio?" },
      { de: "Wann fängt die Arbeit an?",                          es: "¿Cuándo empieza el trabajo?" },
      { de: "Wie viel verdient man hier?",                        es: "¿Cuánto se gana aquí?  (directo, los alemanes lo respetan)" },
      { de: "Vielen Dank für das Gespräch!",                     es: "¡Muchas gracias por la conversación!  (al final de entrevista)" },
      { de: "Bis bald, Bruder.",                                  es: "Hasta pronto, hermano." },
    ],
    truco: "En el sector tech alemán el inglés se mezcla con el alemán todo el tiempo: „Cybersicherheit“, „Pentesting“, „Firewall“ se dicen igual. No tengas miedo de soltar el término en inglés cuando no te salga la palabra alemana — todos lo hacen. „Bitte“ y „danke“ son tu pasaporte: úsalos hasta cuando no toque.",
  },

  grammar: {
    title: "El verbo SIEMPRE en posición 2 — la regla de oro del alemán",
    intro: "Si te aprendes UNA sola cosa de gramática alemana antes de aterrizar, que sea esta: el verbo conjugado va SIEMPRE en la 2ª posición de la frase. Eso significa que „ich“ no siempre va al principio. Cuando lo entiendas, el alemán deja de sonar caótico.",
    table: [
      ["Posición 1",       "Posición 2 (verbo)", "Posición 3+"],
      ["Ich",              "komme",              "aus Ecuador."],
      ["Ich",              "lerne",              "Deutsch."],
      ["Morgen",           "fliege",             "ich nach Berlin."],
      ["In Deutschland",   "arbeitet",           "mein Bruder."],
      ["Heute",            "habe",               "ich ein Interview."],
    ],
    examples: [
      "Ich heiße César.   →   Me llamo César.",
      "Morgen komme ich nach Deutschland.   →   Mañana voy a Alemania.",
      "Hier wohnt mein Bruder.   →   Aquí vive mi hermano.",
      "In Berlin gibt es viel Arbeit.   →   En Berlín hay mucho trabajo.",
    ],
    claveEs:
      "💡 Truco para que se te pegue: si arrancas la frase con „Morgen…“, „Heute…“, „In Deutschland…“ o cualquier palabra de tiempo/lugar, el VERBO viene INMEDIATAMENTE DESPUÉS y el „ich“ se va al tercer lugar. En español decimos „mañana yo voy“, pero en alemán es „mañana voy yo“ („morgen fliege ich“). Practícalo mandándole audios a tu hermano — al inicio te va a sonar invertido, en 2 semanas te sale solo.",
  },

  dialogue: {
    title: "El primer audio a tu hermano — en alemán",
    scenarioEs: "Imagina: terminas tu primera semana de clases. Le mandas a tu hermano un audio en alemán para sorprenderlo. Te aclaras la garganta, miras al teléfono y le das al botón rojo.",
    lines: [
      { s: "César",   t: "Hey Bruder, was geht ab?" },
      { s: "Hermano", t: "Aleeerta, ¿estás hablando en alemán?? Du sprichst Deutsch! Wann kommst du?" },
      { s: "César",   t: "Bald! Ich lerne Deutsch und ich komme nach Deutschland!" },
      { s: "Hermano", t: "Geil! Was willst du dort machen?" },
      { s: "César",   t: "Ich suche Arbeit in Cybersicherheit. Ich habe Erfahrung mit IT." },
      { s: "Hermano", t: "Perfekt! Hier in Berlin gibt es viel Arbeit in IT. Komm einfach, ich helfe dir." },
      { s: "César",   t: "Vielen Dank, Bruder. Bis bald!" },
    ],
  },

  mistakes: [
    {
      wrong: "Ich bin 30 Jahre.",
      right: "Ich bin 30 Jahre ALT.",
      why:   "En alemán la edad lleva siempre „alt“ (literalmente: „tengo 30 años viejo“). Sin „alt“ suena raro. Es de los primeros errores que delatan a un principiante en una entrevista.",
    },
    {
      wrong: "Ich komme VON Ecuador.",
      right: "Ich komme AUS Ecuador.",
      why:   "Para países, ciudades y continentes se usa „aus“, no „von“. „Von“ es para personas: „Das ist von meinem Bruder“ (esto es de mi hermano). Memoriza: AUS para lugar, VON para persona.",
    },
    {
      wrong: "Mein Name César ist.",
      right: "Mein Name IST César.",
      why:   "Verbo en posición 2 — siempre. „Mein Name“ ocupa la posición 1 (es UN bloque), „ist“ va en la 2, „César“ va en la 3. Esta es la regla más violada por hispanohablantes; cuando la domines, suenas el doble de fluido.",
    },
  ],

  testimonials: [
    {
      name: "María José Q.", city: "Frankfurt · Enfermera · 31 años",
      levelStart: "A1", levelNow: "B1",
      text: "Hice el Pack Fluidez Total en grupo y en 6 meses pasé de A1 a B1. Hoy trabajo de enfermera en un hospital en Frankfurt — el alemán me dio TODO. Sin esta academia no estaría aquí. Aprender en grupo me hizo perder el miedo a hablar: éramos 8, todos en el mismo punto, y reírnos juntos del Konjunktiv fue lo que me dio confianza. Si te dicen que el alemán es imposible, sí cuesta — pero con el grupo correcto se vuelve divertido.",
    },
    {
      name: "Diego R.", city: "Berlín · DevOps · 29 años",
      levelStart: "A0", levelNow: "B1",
      text: "Llegué a Berlín con A0 y un contrato de DevOps que conseguí remoto desde Quito. En 7 meses con la academia pasé a B1 y ahora hago standups en alemán sin sudar. Vale cada euro.",
    },
    {
      name: "Pablo R.", city: "Hamburgo · Soldador · 35 años",
      levelStart: "A0", levelNow: "B1",
      text: "Mi hermano vivía aquí desde hacía 3 años, yo llegué con A2 después de 5 meses. La primera vez que hablé con mi cuñada alemana entendió todo. Ahora soy yo el que se ríe del primer audio que le mandé.",
    },
  ],
};

// ── Generate ────────────────────────────────────────────────
fs.mkdirSync(ROOT, { recursive: true });

// CLI: `node marketing-pdf.mjs --only=CESAR` genera solo el de César.
// Default sin args: genera los 7 PDFs marketing estándar.
const onlyArg = process.argv.find(a => a.startsWith("--only="))?.split("=")[1];
const ALL_PDFS = onlyArg === "CESAR"
  ? [PDF_CESAR]
  : [PDF1, PDF2, PDF3, PDF4, PDF5, PDF6, PDF7];

for (const D of ALL_PDFS) {
  const doc = buildDoc(D);
  const buf = await Packer.toBuffer(doc);
  const safeTitle = D.title.replace(/\s+/g, "-").toLowerCase()
    .replace(/[^a-z0-9\-]/g, "");
  const filePrefix = onlyArg === "CESAR" ? "Cesar-personal" : `${D.level.replace(/\./g, "_")}-guia-${D.pdfNumber}`;
  const out = path.join(ROOT, `${filePrefix}-${safeTitle}.docx`);
  fs.writeFileSync(out, buf);
  console.log(`✔ ${path.basename(out)}  (${(buf.length / 1024).toFixed(1)} KB)`);
}
console.log("\n✓ Generado. Ahora convertir a PDF (Word COM).");
