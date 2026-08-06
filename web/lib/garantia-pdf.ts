import PDFDocument from "pdfkit";

/**
 * PDF del certificado "Garantía de Nivel por Escrito".
 *
 * A4 vertical, branding navy/dorado, aspecto de certificado formal —
 * el estudiante debe sentir orgullo al enseñarlo. Mismo stack pdfkit
 * que las facturas y los Zertifikate de nivel (fonts built-in, buffer
 * en memoria, sin storage).
 */

export type GarantiaPdfVars = {
  nombreCompleto:  string;
  /** Etiqueta legible de la meta, ej. "B1", "Fluidez Total". */
  metaLabel:       string;
  /** Etiqueta del ritmo, ej. "Estándar", o "Pago único". */
  ritmoLabel:      string;
  /** dd/mm/yyyy o fecha legible. */
  fechaConversion: string;
  /** ej. "febrero de 2027". */
  fechaLlegada:    string;
  /** GN-2026-00042 */
  idUnico:         string;
  /** dd/mm/yyyy */
  fechaEmision:    string;
};

const NAVY  = "#1B2A4A";
const NAVY_LIGHT = "#3D4F6F";
const GOLD  = "#B8933E";
const GOLD_LIGHT = "#D4BC7D";
const CREAM = "#FDFBF6";
const GRAY  = "#64748b";

export function buildGarantiaPdf(v: GarantiaPdfVars): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const W = doc.page.width;   // 595
  const H = doc.page.height;  // 842

  // ── Fondo crema + marco doble dorado/navy ─────────────────────────
  doc.rect(0, 0, W, H).fill(CREAM);
  doc.lineWidth(3).strokeColor(GOLD).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(0.8).strokeColor(NAVY).rect(32, 32, W - 64, H - 64).stroke();

  // Ornamentos de esquina (dobles L doradas)
  const orn = 26;
  for (const [cx, cy, sx, sy] of [
    [40, 40, 1, 1], [W - 40, 40, -1, 1],
    [40, H - 40, 1, -1], [W - 40, H - 40, -1, -1],
  ] as const) {
    doc.lineWidth(1.6).strokeColor(GOLD)
      .moveTo(cx, cy + sy * orn).lineTo(cx, cy).lineTo(cx + sx * orn, cy).stroke();
    doc.lineWidth(0.7).strokeColor(GOLD_LIGHT)
      .moveTo(cx + sx * 5, cy + sy * (orn - 6)).lineTo(cx + sx * 5, cy + sy * 5).lineTo(cx + sx * (orn - 6), cy + sy * 5).stroke();
  }

  // ── Cabecera ──────────────────────────────────────────────────────
  let y = 64;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(GOLD)
    .text("APRENDER-ALEMAN.DE", 0, y, { width: W, align: "center", characterSpacing: 3 });
  y += 26;
  doc.font("Helvetica-Bold").fontSize(26).fillColor(NAVY)
    .text("GARANTÍA DE NIVEL", 0, y, { width: W, align: "center", characterSpacing: 1.5 });
  y += 32;
  doc.font("Helvetica").fontSize(13).fillColor(NAVY_LIGHT)
    .text("POR ESCRITO", 0, y, { width: W, align: "center", characterSpacing: 5 });
  y += 24;

  // Línea decorativa central con diamante
  const mid = W / 2;
  doc.lineWidth(1).strokeColor(GOLD)
    .moveTo(mid - 110, y).lineTo(mid - 12, y).stroke()
    .moveTo(mid + 12, y).lineTo(mid + 110, y).stroke();
  doc.save().translate(mid, y).rotate(45)
    .rect(-4, -4, 8, 8).fill(GOLD).restore();
  y += 22;

  // ── Datos del certificado ─────────────────────────────────────────
  doc.font("Helvetica").fontSize(10.5).fillColor(GRAY)
    .text("Certificado emitido para", 0, y, { width: W, align: "center" });
  y += 16;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY)
    .text(v.nombreCompleto, 60, y, { width: W - 120, align: "center" });
  y += 34;

  // Fila de metadatos (programa / inicio / llegada) en 3 columnas
  const colW = (W - 140) / 3;
  const cols: Array<[string, string]> = [
    ["PROGRAMA", `${v.metaLabel} · ${v.ritmoLabel}`],
    ["FECHA DE INICIO", v.fechaConversion],
    ["LLEGADA ESTIMADA", v.fechaLlegada],
  ];
  cols.forEach(([label, value], i) => {
    const x = 70 + i * colW;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GOLD)
      .text(label, x, y, { width: colW, align: "center", characterSpacing: 1.2 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY)
      .text(value, x, y + 12, { width: colW, align: "center" });
  });
  y += 44;

  doc.font("Helvetica").fontSize(8.5).fillColor(GRAY)
    .text(`Nº de certificado: ${v.idUnico}`, 0, y, { width: W, align: "center", characterSpacing: 0.5 });
  y += 24;

  // ── Nuestro compromiso ────────────────────────────────────────────
  const LX = 76;
  const TW = W - 152;

  const sectionTitle = (t: string) => {
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(GOLD)
      .text(t, LX, y, { width: TW, characterSpacing: 1.5 });
    y += 16;
  };
  const body = (t: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opts.size ?? 9.5).fillColor(NAVY_LIGHT)
      .text(t, LX, y, { width: TW, align: "justify", lineGap: 1.5 });
    y = doc.y + 8;
  };

  sectionTitle("NUESTRO COMPROMISO CONTIGO");
  body("En Aprender-Aleman.de no vendemos clases — nos comprometemos con tu resultado. Por eso te garantizamos por escrito:");
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY)
    .text(
      `Si al completar tu programa ${v.metaLabel} no alcanzas tu nivel objetivo, continuaremos tus clases COMPLETAMENTE GRATIS hasta que lo consigas. Sin límite de clases adicionales. Sin coste extra. Hasta que llegues.`,
      LX, y, { width: TW, align: "justify", lineGap: 1.5 },
    );
  y = doc.y + 12;

  sectionTitle("TU PARTE DEL COMPROMISO");
  body("Esta garantía se mantiene activa cumpliendo dos condiciones — las mismas que garantizan tu aprendizaje:");
  body("✓  Asistir al menos al 85% de tus clases programadas", { bold: true });
  y -= 4;
  body("✓  Completar al menos el 85% de tus ejercicios en la plataforma SCHULE", { bold: true });
  body("Podrás consultar el estado de tu garantía en cualquier momento desde tu panel de estudiante.");

  sectionTitle("CÓMO SE VERIFICA EL NIVEL");
  body("El nivel alcanzado se evalúa al completar el programa mediante nuestra prueba de nivel interna (equivalente al marco MCER) y/o simulacro de examen oficial Goethe/TELC según tu meta.");

  sectionTitle("CONDICIONES GENERALES");
  const conds = [
    `La garantía cubre el programa contratado y su nivel objetivo: ${v.metaLabel}`,
    "Aplica a todos los ritmos de suscripción activa y pagos únicos",
    "Las pausas acordadas con la academia no rompen la garantía; la cancelación de la suscripción la finaliza",
    "Las clases de continuación gratuitas mantienen tu mismo formato individual",
  ];
  for (const c of conds) {
    doc.font("Helvetica").fontSize(9).fillColor(NAVY_LIGHT)
      .text(`·  ${c}`, LX + 4, y, { width: TW - 8, lineGap: 1 });
    y = doc.y + 4;
  }

  // ── Pie: sello + emisión ──────────────────────────────────────────
  const footY = H - 118;

  // Sello circular dorado a la derecha
  const sealX = W - 130;
  const sealY = footY + 18;
  doc.lineWidth(1.6).strokeColor(GOLD).circle(sealX, sealY, 34).stroke();
  doc.lineWidth(0.6).strokeColor(GOLD_LIGHT).circle(sealX, sealY, 29).stroke();
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(GOLD)
    .text("GARANTÍA", sealX - 30, sealY - 12, { width: 60, align: "center", characterSpacing: 1 })
    .text("DE NIVEL", sealX - 30, sealY - 4, { width: 60, align: "center", characterSpacing: 1 });
  doc.font("Helvetica").fontSize(5.5).fillColor(GOLD)
    .text("APRENDER-ALEMAN.DE", sealX - 30, sealY + 6, { width: 60, align: "center" });

  // Línea de firma a la izquierda
  doc.lineWidth(0.7).strokeColor(NAVY).moveTo(76, footY + 34).lineTo(260, footY + 34).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(GRAY)
    .text("Gelfis Horn · Fundador", 76, footY + 39, { width: 184 });

  doc.font("Helvetica").fontSize(7.5).fillColor(GRAY)
    .text(
      `Emitido digitalmente por Aprender-Aleman.de (Linguify Global LLC) · ${v.fechaEmision}`,
      0, H - 58, { width: W, align: "center" },
    );

  doc.end();
  return done;
}
