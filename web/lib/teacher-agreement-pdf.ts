import PDFDocument from "pdfkit";

/**
 * Acuerdo de Colaboración con Profesores — PDF personalizado (Gelfis
 * 2026-10-15). Texto = versión v2 (octubre 2026) del documento marco que
 * Gelfis venía generando a mano en Google Docs por profesor. Se genera al
 * aprobar al profe y viaja adjunto en el email de bienvenida.
 *
 * Al cambiar el texto del acuerdo: actualizar AGREEMENT_VERSION.
 */
export const AGREEMENT_VERSION = "acuerdo-profesores-v2.0 (octubre 2026)";

export type AgreementVars = {
  name:      string;
  email:     string;
  phone:     string | null;
  country:   string | null;    // código ISO (ES, CO, MX…) o null/"XX" si no consta
  address:   string | null;    // dirección libre del registro (ciudad incluida)
  startDate: Date;             // fecha de inicio de la colaboración (aprobación)
  rateEur:   number | null;    // tarifa por clase de 50 min
  rango:     string | null;    // starter | pro | elite | master
  /** Firma de la academia (PNG) y fecha: si viene, el PDF sale firmado por Gelfis. */
  adminSignature?: { png: Buffer; date: Date } | null;
};

const COUNTRY_ES: Record<string, string> = {
  ES: "España", DE: "Alemania", AT: "Austria", CH: "Suiza", CO: "Colombia", MX: "México", AR: "Argentina",
  CL: "Chile", PE: "Perú", VE: "Venezuela", EC: "Ecuador", BO: "Bolivia", PY: "Paraguay", UY: "Uruguay",
  CR: "Costa Rica", PA: "Panamá", DO: "República Dominicana", CU: "Cuba", GT: "Guatemala", HN: "Honduras",
  SV: "El Salvador", NI: "Nicaragua", PT: "Portugal", IT: "Italia", FR: "Francia", GB: "Reino Unido", US: "Estados Unidos",
};
const RANGO_ES: Record<string, string> = { starter: "Starter (5 %)", pro: "Pro (8 %)", elite: "Elite (12 %)", master: "Master (15 %)" };

/** "País / Ciudad" legible: dirección del registro + país; nunca un código suelto tipo "XX". */
export function agreementLocation(country: string | null, address: string | null): string | null {
  const code = (country ?? "").trim().toUpperCase();
  const countryName = code && code !== "XX" ? (COUNTRY_ES[code] ?? code) : null;
  const addr = (address ?? "").trim();
  if (addr && countryName && !addr.toLowerCase().includes(countryName.toLowerCase())) return `${addr}, ${countryName}`;
  if (addr) return addr;
  return countryName;
}

const BONOS = "Viajero: 25 €  ·  Estándar: 35 €  ·  Intensivo: 50 €  ·  VIP Express: 75 €  ·  Pago único: 150 €";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
}

export async function buildTeacherAgreementPdf(v: AgreementVars): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4", margin: 56,
    info: { Title: "Acuerdo de Colaboración con Profesores · Aprender-Aleman.de", Author: "Aprender-Aleman.de (Linguify Global LLC)" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Cabecera y número de página en cada hoja (como en los PDF manuales de Gelfis).
  let pageNo = 0;
  const stampPage = () => {
    pageNo += 1;
    const y0 = doc.y;
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text(`Aprender-Aleman.de · Acuerdo de Colaboración v2 · ${v.name}`, doc.page.margins.left, 28, { width: W, align: "left", lineBreak: false })
      .text(`Página ${pageNo}`, doc.page.margins.left, 28, { width: W, align: "right", lineBreak: false });
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
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("Acuerdo de Colaboración con Profesores");
  doc.font("Helvetica-Oblique").fontSize(9).fillColor("#64748b").text("Documento marco para profesores colaboradores · Versión v2 · Octubre 2026");
  doc.moveDown(0.6);
  P("Este acuerdo define la relación entre Aprender-Aleman.de (operada por Linguify Global LLC) y el profesor colaborador. Sustituye a la versión anterior e incorpora por escrito los acuerdos que hasta ahora eran verbales, para que ambas partes tengan claras sus responsabilidades, el pago y el reparto de riesgos.");

  H1("1. Datos del profesor");
  KV("Nombre", v.name);
  KV("Email", v.email);
  KV("WhatsApp", v.phone ?? "________________________");
  KV("País / Ciudad", agreementLocation(v.country, v.address) ?? "________________________");
  KV("Fecha de inicio de la colaboración", fmtDate(v.startDate));
  KV("Tarifa por clase (50 minutos)", v.rateEur != null ? `${v.rateEur.toLocaleString("es-ES")} €` : "según su ficha en la plataforma");
  KV("Rango de comisión inicial", v.rango ? (RANGO_ES[v.rango.toLowerCase()] ?? v.rango) : "Starter (5 %)");

  H1("2. Naturaleza de la colaboración");
  B("El profesor colabora como profesional independiente (autónomo/freelance), no como empleado. Emite sus propias facturas a Linguify Global LLC y es responsable de sus obligaciones fiscales en su país de residencia.");
  B("Imparte clases privadas de alemán (1 a 1, Dúo o Trío) a los estudiantes que la academia le asigne.");
  B("No hay exclusividad salvo pacto expreso: puede colaborar con otras entidades siempre que cumpla la disponibilidad acordada.");

  H1("3. Responsabilidades del profesor");
  B("Impartir las clases con puntualidad, calidad y siguiendo la metodología de la academia.");
  B("Registrar la asistencia y los ejercicios de cada alumno en el sistema de la academia tras cada clase.");
  B("Dar seguimiento al progreso del alumno e informar de forma oportuna cuando un alumno muestre un ritmo de avance que ponga en riesgo su meta en el plazo acordado (ver punto 7.3). Este informe se registra en el panel y es condición del reparto de la Garantía de Nivel.");
  B("Comunicar con antelación cualquier ausencia o reprogramación propia (ver punto 6).");
  B("Preparar y presentar las clases de prueba siguiendo el guion oficial de la academia cuando se le asignen leads.");
  B("Mantener la confidencialidad de los datos de los estudiantes y de la información interna.");

  H1("4. Pago al profesor");
  H2("4.1 Tarifa docente");
  B(`Cobra por clase efectivamente impartida y registrada en el sistema. Tarifa por clase (50 minutos): ${v.rateEur != null ? `${v.rateEur.toLocaleString("es-ES")} €` : "según su ficha en la plataforma"}.`);
  B("Pago mensual sobre las clases registradas, previa emisión de factura del profesor a Linguify Global LLC, con el desglose mensual que entrega la academia.");
  H2("4.2 Inasistencia del alumno");
  B("Si el alumno no asiste a una clase programada, o la cancela con menos de 24 horas de antelación, la clase se considera impartida: se descuenta del plan del alumno y se paga al profesor a tarifa completa, siempre que el profesor haya estado presente y lo registre en el sistema.");
  H2("4.3 Comisiones por ventas");
  B(`Cierre propio (E1): si el profesor cierra la inscripción de un lead de su clase de prueba, recibe un bono de cierre según el ritmo contratado por el alumno, más la comisión porcentual según su rango vigente en el sistema de comisiones (rango inicial: ${v.rango ? (RANGO_ES[v.rango.toLowerCase()] ?? v.rango) : "Starter (5 %)"}; sube por resultados):`);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a").text(BONOS, { width: W, align: "center" }); doc.moveDown(0.3);
  B("Cierre por closer (E2): si la clase de prueba fue del profesor pero la venta la cierra un closer, el profesor recibe el 50% del bono correspondiente al ritmo contratado.");
  B("Renovación: si el profesor cierra la continuidad de un alumno propio al siguiente nivel, recibe el bono completo según el ritmo de la renovación, igual que un cierre E1.");
  B("Los porcentajes por rango y su cálculo se publican en el panel del profesor (sección Ganancias) y pueden actualizarse; cualquier cambio se comunica con antelación y nunca se aplica con efecto retroactivo.");

  H1("5. Clases de prueba, imagen y publicidad");
  H2("5.1 Grabaciones");
  B("Las grabaciones de clases (de prueba y regulares) se conservan para uso interno exclusivamente: evaluación de calidad, feedback al profesor y seguimiento de los cursos. La academia podrá revisarlas con conocimiento del profesor.");
  H2("5.2 Uso de imagen");
  B("Cualquier uso de la imagen, voz o nombre del profesor en publicaciones o publicidad requiere el acuerdo previo y libre de ambas partes, caso por caso. Ninguna grabación interna se usa con fines publicitarios sin ese acuerdo.");
  H2("5.3 Publicidad personalizada (voluntaria)");
  B("La participación del profesor en contenido publicitario (videos, testimonios, anuncios con su imagen) es voluntaria. Realizarla conlleva los beneficios o estímulos que se acuerden en cada caso.");
  B("La realización o no de publicidad personalizada no afecta el reparto de las clases de prueba del pool general, que se asigna por disponibilidad y rotación del sistema.");

  H1("6. Asistencia, cancelaciones y reprogramaciones");
  B("Alumno: puede cancelar o reprogramar hasta 24 horas antes sin coste. Con menos de 24 horas o inasistencia, aplica el punto 4.2.");
  B("Profesor: avisa con al menos 48 horas de antelación, salvo fuerza mayor. Las clases canceladas por el profesor se reprograman con el alumno, o las cubre otro profesor del pool si el alumno lo prefiere.");
  B("Cancelaciones reiteradas sin aviso pueden dar lugar a revisión o terminación de la colaboración.");

  H1("7. Garantía de Nivel — reparto de responsabilidad");
  P("La academia ofrece a sus estudiantes una Garantía de Nivel. El texto íntegro del Certificado de Garantía que recibe cada estudiante se incluye como Anexo A de este acuerdo. Las condiciones detalladas de la garantía constan además en el § 6 de los Términos y Condiciones de la academia.");
  H2("7.1 Condición previa (protección para ambas partes)");
  B("La garantía SOLO se activa si el estudiante cumplió el 85% de asistencia y el 85% de los ejercicios asignados, verificado automáticamente por el sistema de la academia. Sin esa condición, no se generan clases gratuitas. El registro automático es la prueba objetiva.");
  H2("7.2 Criterio de nivel alcanzado");
  B("El nivel se da por logrado mediante la evaluación interna de la academia: prueba de nivel en SCHULE más la valoración del profesor, conforme a los descriptores del MCER. La garantía no comprende la superación de exámenes oficiales de terceros (Goethe, telc, ÖSD).");
  B("El cumplimiento de los ejercicios de aprendizaje autónomo del alumno debe ser acorde al progreso de las clases, no solo un resultado acumulado al final: el sistema registra el avance de forma continua y es visible para profesor y academia.");
  B("A mitad del programa de cada alumno se realiza una evaluación intermedia (test de progreso en SCHULE), que sirve de punto de control objetivo del avance y del ritmo de ejercicios.");
  H2("7.3 Informes de progreso — la responsabilidad del profesor");
  B("Cuando el profesor detecte que un alumno tiende a no poder cumplir su meta en el plazo estipulado, debe registrar un aviso en el panel (informe de riesgo) y avisar personalmente a la dirección de la academia (Gelfis Horn) tan pronto lo detecte. Con ese aviso, la academia busca opciones con el alumno (ajuste de ritmo, pausa acordada, refuerzo) para evitar que se active la garantía.");
  H2("7.4 Clases de garantía — reparto del coste");
  B("Si el profesor informó pertinentemente (7.3) y aun así la garantía se activa: las clases de garantía se pagan al profesor a tarifa completa (100%). La academia asume el coste íntegro desde su banco de clases de garantía por alumno. La garantía no recae en el profesor que cumplió su deber de aviso.");
  B("Si no hubo informes de progreso pese a señales detectables en el sistema: las clases de garantía se imparten a tarifa reducida al 50%, asumiendo la academia el resto, como reparto del riesgo compartido.");
  B("La academia dispone un banco (colchón) de clases de garantía por alumno como provisión interna de coste. Este banco no limita el compromiso con el estudiante: es la reserva con la que la academia lo financia. El objetivo compartido de ambas partes es que no se use: expectativas realistas al acordar ritmo y plazo, informes a tiempo y alternativas tempranas con el alumno.");
  H2("7.5 Material didáctico");
  B("La academia se compromete a la mejora continua del material (pensum con hilo conductor de lección a lección, formatos interactivos, ejercicios de aplicación). Las propuestas del profesorado sobre material se canalizan y priorizan en las revisiones de equipo.");

  H1("8. Calidad y seguimiento");
  B("El profesor recibe formación y materiales (guion de clases de prueba, metodología, herramientas).");
  B("El avance de cada alumno se mide con el sistema automático de asistencia y ejercicios, más la evaluación intermedia del punto 7.2.");

  H1("9. Duración y terminación");
  B("Colaboración indefinida, terminable por cualquiera de las partes con preaviso de 30 días comunicado por escrito (email suficiente).");
  B("Durante el preaviso, ambas partes colaboran en la transición ordenada: los alumnos en curso se reasignan a otro profesor del pool sin afectar su continuidad, y el profesor imparte las clases ya agendadas dentro del período.");
  B("Incumplimientos graves (abandono de alumnos, mala praxis, ruptura de confidencialidad) pueden dar lugar a terminación inmediata.");

  H1("10. Confidencialidad");
  P("El profesor mantendrá la confidencialidad sobre datos de estudiantes, métodos, precios internos y cualquier información de la academia, durante y después de la colaboración.");

  H1("Anexo A — Garantía de Nivel (texto del estudiante)");
  P("Texto del Certificado de Garantía de Nivel que recibe cada estudiante al inscribirse (los datos de programa, fechas y número de certificado varían por alumno):");
  doc.rect(doc.page.margins.left, doc.y, W, 2).fill("#e2e8f0");
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("APRENDER-ALEMAN.DE — GARANTÍA DE NIVEL POR ESCRITO", { width: W, align: "center" });
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Certificado emitido para {Nombre del estudiante} · PROGRAMA: {Nivel objetivo} · {Ritmo} · FECHA DE INICIO: {fecha} · LLEGADA ESTIMADA: {mes y año} · Nº de certificado: GN-2026-xxxxx", { width: W, align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text("NUESTRO COMPROMISO CONTIGO. En Aprender-Aleman.de no vendemos clases: nos comprometemos con tu resultado. Por eso te garantizamos por escrito: si al completar tu programa no alcanzas tu nivel objetivo, continuaremos tus clases COMPLETAMENTE GRATIS hasta que lo consigas. Sin límite de clases adicionales. Sin coste extra. Hasta que llegues.", { width: W, align: "justify" });
  doc.moveDown(0.3);
  doc.text("TU PARTE DEL COMPROMISO. Esta garantía se mantiene activa cumpliendo tres condiciones: asistir al menos al 85% de tus clases programadas, completar al menos el 85% de tus ejercicios en la plataforma SCHULE, y tener los ejercicios de SCHULE completados a más tardar el último día de clases de tu programa. Podrás consultar el estado de tu garantía en cualquier momento desde tu panel de estudiante.", { width: W, align: "justify" });
  doc.moveDown(0.3);
  doc.text("CONDICIONES GENERALES. La garantía cubre el programa contratado y su nivel objetivo · Aplica a todos los ritmos de suscripción activa y pagos únicos · Las pausas acordadas con la academia no rompen la garantía; la cancelación de la suscripción la finaliza · Las clases de continuación gratuitas mantienen tu mismo formato individual. Emitido digitalmente por Aprender-Aleman.de (Linguify Global LLC).", { width: W, align: "justify" });
  doc.moveDown(0.5);
  doc.rect(doc.page.margins.left, doc.y, W, 2).fill("#e2e8f0");

  // Firmas
  doc.moveDown(1.5);
  if (doc.y > doc.page.height - 230) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text("Firmado en conformidad:");
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9.5).fillColor("#334155");
  if (v.adminSignature) {
    // Firma estampada: imagen sobre la línea + fecha rellena.
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
  doc.text(`El profesor colaborador: ${v.name}`);
  doc.text("Firma: _______________________________ · Fecha: _______________________");
  doc.moveDown(1.2);
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#64748b").text("Nota: este documento es un marco de colaboración entre profesionales independientes, no un contrato laboral. Cada parte es responsable de sus obligaciones legales y fiscales en su jurisdicción. Esta versión v2 sustituye a cualquier acuerdo anterior entre las partes.", { width: W, align: "justify" });

  doc.end();
  return done;
}
