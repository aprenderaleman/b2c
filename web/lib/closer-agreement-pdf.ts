import PDFDocument from "pdfkit";
import { agreementLocation } from "./teacher-agreement-pdf";

/**
 * Acuerdo de Colaboración con Closers — PDF personalizado (Gelfis
 * 2026-11-27). Adaptación del acuerdo de profesores (v2) al rol closer:
 * comisiones por rango sobre ventas cobradas, atribución por registro
 * en el panel, canales oficiales y confidencialidad.
 *
 * Al cambiar el texto del acuerdo: actualizar CLOSER_AGREEMENT_VERSION.
 */
export const CLOSER_AGREEMENT_VERSION = "acuerdo-closers-v1.0 (noviembre 2026)";

export type CloserAgreementVars = {
  name:      string;
  email:     string;
  phone:     string | null;
  country:   string | null;
  address:   string | null;
  startDate: Date;
  rango:     string | null;     // rookie | closer | elite | master
  /** Comisión (%) pactada a medida. Si viene, sustituye la línea del rango. */
  comisionPct?: number | null;
  /** Firma de la academia (PNG) y fecha: si viene, el PDF sale firmado. */
  adminSignature?: { png: Buffer; date: Date } | null;
};

const RANGO_CLOSER_ES: Record<string, string> = {
  rookie: "Rookie (8 %)", closer: "Closer (10 %)", elite: "Elite (12 %)", master: "Master (15 %)",
};

const RANGOS_LINEA = "Rookie: 8 %  ·  Closer: 10 %  ·  Elite: 12 %  ·  Master: 15 %";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
}

export async function buildCloserAgreementPdf(v: CloserAgreementVars): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4", margin: 56,
    info: { Title: "Acuerdo de Colaboración con Closers · Aprender-Aleman.de", Author: "Aprender-Aleman.de (Linguify Global LLC)" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  let pageNo = 0;
  const stampPage = () => {
    pageNo += 1;
    const y0 = doc.y;
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text(`Aprender-Aleman.de · Acuerdo de Colaboración Closers v1 · ${v.name}`, doc.page.margins.left, 28, { width: W, align: "left", lineBreak: false })
      .text(`Página ${pageNo}`, doc.page.margins.left, 28, { width: W, align: "right", lineBreak: false });
    // Restaurar el estilo del cuerpo: sin esto, un párrafo que cruza de
    // página continúa con la fuente pequeña del sello.
    doc.font("Helvetica").fontSize(9.5).fillColor("#334155");
    doc.y = y0;
  };
  stampPage();
  doc.on("pageAdded", stampPage);
  const H1 = (t: string) => { doc.moveDown(0.8); doc.font("Helvetica-Bold").fontSize(12.5).fillColor("#0f172a").text(t, { width: W }); doc.moveDown(0.3); };
  const H2 = (t: string) => { doc.moveDown(0.4); doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#1e293b").text(t, { width: W }); doc.moveDown(0.15); };
  const P  = (t: string) => { doc.font("Helvetica").fontSize(9.5).fillColor("#334155").text(t, { width: W, align: "justify", lineGap: 1.5 }); doc.moveDown(0.25); };
  const B  = (t: string) => { doc.font("Helvetica").fontSize(9.5).fillColor("#334155").text("•  " + t, { width: W - 14, align: "justify", lineGap: 1.5 }); doc.moveDown(0.15); };
  const KV = (k: string, val: string) => { doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#334155").text(k + ": ", { continued: true }); doc.font("Helvetica").text(val); };

  // Cabecera
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Aprender-Aleman.de");
  doc.font("Helvetica").fontSize(9).fillColor("#64748b").text("Linguify Global LLC · 30 N Gould St Ste R, Sheridan, WY 82801, EE. UU. · EIN 35-2952512");
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("Acuerdo de Colaboración con Closers");
  doc.font("Helvetica-Oblique").fontSize(9).fillColor("#64748b").text("Documento marco para closers colaboradores · Versión v1 · Noviembre 2026");
  doc.moveDown(0.6);
  P("Este acuerdo define la relación entre Aprender-Aleman.de (operada por Linguify Global LLC) y el closer colaborador: el profesional que acompaña a los interesados después de su clase de prueba y les ayuda a inscribirse en el plan adecuado. Pone por escrito las responsabilidades, la compensación y las reglas del trabajo, para que ambas partes las tengan claras desde el primer día.");

  H1("1. Datos del closer");
  KV("Nombre", v.name);
  KV("Email", v.email);
  KV("WhatsApp", v.phone ?? "________________________");
  KV("País / Ciudad", agreementLocation(v.country, v.address) ?? "________________________");
  KV("Fecha de inicio de la colaboración", fmtDate(v.startDate));
  if (v.comisionPct != null) KV("Comisión acordada", `${String(v.comisionPct).replace(".", ",")} %`);
  else KV("Rango de comisión inicial", v.rango ? (RANGO_CLOSER_ES[v.rango.toLowerCase()] ?? v.rango) : "Rookie (8 %)");

  H1("2. Naturaleza de la colaboración");
  B("El closer colabora como profesional independiente (autónomo/freelance), no como empleado. Emite sus propias facturas a Linguify Global LLC y es responsable de sus obligaciones fiscales en su país de residencia.");
  B("Su función es comercial: contactar a los leads que la academia le asigna, asesorarlos sobre el plan adecuado a su meta y acompañarlos hasta la inscripción. No imparte clases ni asesora sobre contenidos académicos.");
  B("No hay exclusividad salvo pacto expreso: puede colaborar con otras entidades siempre que cumpla la dedicación y los tiempos de respuesta acordados.");

  H1("3. Responsabilidades del closer");
  B("Contactar a los leads asignados dentro de los plazos que marca el panel. Las tareas de llamada tienen fecha de vencimiento ligada al bono del lead (48 horas tras su clase de prueba): la velocidad de primer contacto es parte esencial del trabajo y se mide en el sistema.");
  B("Registrar TODA interacción con un lead en el panel en el momento en que ocurre, con nota descriptiva (resultado, objeción, acuerdos). El registro es la base de la atribución de comisiones (punto 5) y del seguimiento del equipo.");
  B("Usar exclusivamente los canales oficiales de la academia para comunicarse con los leads (WhatsApp y email de la plataforma, videollamadas del panel). Nunca canales o números personales.");
  B("Ofrecer únicamente los planes, precios y promociones vigentes del catálogo oficial, usando los formularios y enlaces del panel. El closer no concede descuentos, extensiones de bono ni condiciones especiales por su cuenta.");
  B("Seguir los guiones y el método de venta de la academia (documento de bienvenida) y participar en las revisiones de calidad que se acuerden.");
  B("Tratar los datos personales de los leads conforme a las instrucciones de la academia y al RGPD: solo para el trabajo encomendado, sin copias fuera de la plataforma y con deber de confidencialidad indefinido.");

  H1("4. Compensación");
  H2("4.1 Comisión por venta");
  B("El closer cobra comisión sobre cada venta que el sistema le atribuya y que haya sido efectivamente cobrada por la academia (pago confirmado por la pasarela o por la administración en caso de transferencia). No hay salario fijo ni pago por llamada.");
  B("El porcentaje depende de su rango vigente en el sistema de comisiones (rango inicial: " + (v.rango ? (RANGO_CLOSER_ES[v.rango.toLowerCase()] ?? v.rango) : "Rookie (8 %)") + "; sube por resultados):");
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a").text(RANGOS_LINEA, { width: W, align: "center" }); doc.moveDown(0.3);
  B("Bono de rescate: si la venta corresponde a un lead que NO asistió a su clase de prueba y el closer lo recupera hasta la inscripción, recibe un 3 % adicional sobre el importe de esa venta.");
  B("Cuando la clase de prueba fue impartida por un profesor de la academia, este percibe su comisión de pre-calificación por cuenta de la academia; no se descuenta de la comisión del closer. La suma de comisiones de una venta está sujeta a un tope conjunto del 18 % del importe.");
  B("Los porcentajes por rango, los criterios de ascenso y el detalle de cada comisión se publican en el panel del closer (sección Mis números) y pueden actualizarse; cualquier cambio se comunica con antelación y nunca se aplica con efecto retroactivo.");
  H2("4.2 Liquidación y pago");
  B("Liquidación mensual sobre las ventas cobradas y aprobadas en el mes, previa emisión de factura del closer a Linguify Global LLC con el desglose que entrega la academia.");
  B("Si un pago que generó comisión es devuelto, reembolsado o impagado (chargeback), la comisión correspondiente se descuenta de la siguiente liquidación.");

  H1("5. Atribución de ventas");
  B("Una venta se atribuye al closer cuando el sistema registra actividad suya con ese lead (acciones en el panel) antes del pago, conforme a las reglas de atribución vigentes de la plataforma. El registro en el panel es la prueba objetiva: el trabajo no registrado no genera atribución.");
  B("Las ventas y sus comisiones pasan por la aprobación de la administración antes de liquidarse.");

  H1("6. Calidad, grabaciones y uso de imagen");
  B("Las videollamadas y sesiones realizadas a través de la plataforma pueden grabarse para uso interno exclusivamente: control de calidad, feedback al closer y mejora de los guiones. La academia podrá revisarlas con conocimiento del closer.");
  B("Cualquier uso de la imagen, voz o nombre del closer en publicaciones o publicidad requiere el acuerdo previo y libre de ambas partes, caso por caso.");

  H1("7. Duración y terminación");
  B("Colaboración indefinida, terminable por cualquiera de las partes con preaviso de 30 días comunicado por escrito (email suficiente).");
  B("Durante el preaviso el closer completa el seguimiento de los leads en curso o facilita su traspaso ordenado. Al terminar, la cartera de leads vuelve a la academia y se liquidan las comisiones de las ventas ya cobradas hasta la fecha efectiva.");
  B("Incumplimientos graves (uso indebido de datos de leads, venta fuera de catálogo, ruptura de confidencialidad, desvío de clientes) pueden dar lugar a terminación inmediata.");

  H1("8. Confidencialidad");
  P("El closer mantendrá la confidencialidad sobre los datos de leads y estudiantes, los guiones y métodos de venta, los precios y condiciones internas y cualquier otra información de la academia, durante y después de la colaboración. Los datos de leads son propiedad de la academia y no podrán usarse para ningún fin ajeno a este acuerdo.");

  // Firmas
  doc.moveDown(1.5);
  if (doc.y > doc.page.height - 230) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text("Firmado en conformidad:");
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9.5).fillColor("#334155");
  if (v.adminSignature) {
    const sigH = 46;
    const sigY = doc.y;
    doc.image(v.adminSignature.png, doc.page.margins.left + 250, sigY - 6, { fit: [170, sigH] });
    doc.y = sigY + sigH - 4;
    doc.font("Helvetica").fontSize(9.5).fillColor("#334155");
    doc.text("Por Aprender-Aleman.de (Linguify Global LLC): _______________________________");
    doc.text(`Gelfis Horn, Managing Member · Fecha: ${fmtDate(v.adminSignature.date)}`);
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#94a3b8").text(`Firmado digitalmente desde la plataforma el ${v.adminSignature.date.toISOString().slice(0, 16).replace("T", " ")} UTC`);
    doc.font("Helvetica").fontSize(9.5).fillColor("#334155");
  } else {
    doc.text("Por Aprender-Aleman.de (Linguify Global LLC): _______________________________");
    doc.text("Gelfis Horn, Managing Member · Fecha: _______________________");
  }
  doc.moveDown(1.2);
  doc.text(`El closer colaborador: ${v.name}`);
  doc.text("Firma: _______________________________ · Fecha: _______________________");
  doc.moveDown(1.2);
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#64748b").text("Nota: este documento es un marco de colaboración entre profesionales independientes, no un contrato laboral. Cada parte es responsable de sus obligaciones legales y fiscales en su jurisdicción.", { width: W, align: "justify" });

  doc.end();
  return done;
}
