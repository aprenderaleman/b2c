import { supabaseAdmin } from "./supabase";
import { buildGarantiaPdf, type GarantiaPdfVars } from "./garantia-pdf";
import { RITMOS, type RitmoId, type GoalId } from "./trial-packs";

/**
 * Emisión del certificado PDF "Garantía de Nivel por Escrito".
 *
 * (El MOTOR de la garantía — % asistencia + % SCHULE + estado — vive
 * en garantia-nivel.ts; este módulo solo emite el certificado.)
 *
 * Se emite automáticamente al convertirse un lead en estudiante del
 * Método Nativo (Stripe auto, transferencia aprobada, confirmación
 * manual del closer/profe) y retroactivamente vía el backfill admin.
 *
 * Metadata en `certificates` (type garantia_nivel):
 *   extra_label → nº GN-YYYY-NNNNN
 *   date_from   → fecha de conversión
 *   date_to     → fecha de llegada estimada (primer día del mes)
 *   description → "Meta X · Ritmo Y"
 */

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const GOAL_LABELS: Record<string, string> = {
  a1_a2:         "A1-A2",
  b1:            "B1",
  b2:            "B2",
  c1:            "C1",
  fluidez_total: "Fluidez Total",
  kids:          "Pack Kids",
};

const RITMO_LABELS: Record<string, string> = {
  viajero:     "Viajero",
  estandar:    "Estándar",
  intensivo:   "Intensivo",
  vip_express: "VIP Express",
};

/** Cadencia de referencia para pagos únicos (clases/mes). */
const REFERENCE_CLASSES_PER_MONTH = 8;

function fechaLlegadaFromMonths(from: Date, months: number): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return `${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatFecha(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export type GarantiaSource = {
  /** meta cruda: a1_a2 / b1 / ... o texto libre. */
  meta:            string | null;
  /** ritmo: viajero / estandar / ... o null (pago único). */
  ritmo:           string | null;
  /** 'suscripcion' | 'unico' (o null → se infiere de ritmo). */
  tipoPago:        string | null;
  clasesTotales:   number | null;
  fechaConversion: Date;
};

export function resolveGarantiaVars(
  nombreCompleto: string,
  src: GarantiaSource,
): Omit<GarantiaPdfVars, "idUnico"> {
  const metaKey = (src.meta ?? "").toLowerCase().trim();
  const metaLabel = GOAL_LABELS[metaKey] ?? (src.meta?.trim() || "tu nivel objetivo");

  const isSubscription = src.tipoPago === "suscripcion" || (src.tipoPago == null && !!src.ritmo);
  const ritmoLabel = isSubscription && src.ritmo
    ? (RITMO_LABELS[src.ritmo] ?? src.ritmo)
    : "Pago único";

  // Meses: matriz meta×ritmo si es suscripción con combo conocido;
  // pago único con cadencia de referencia 8/mes; fallback 6 meses.
  let months: number | null = null;
  if (isSubscription && src.ritmo) {
    const r = RITMOS.find(x => x.id === (src.ritmo as RitmoId));
    const g = r?.goals.find(x => x.id === (metaKey as GoalId));
    months = g?.months ?? null;
    if (months == null && src.clasesTotales && r?.classesPerMonth) {
      months = Math.ceil(src.clasesTotales / r.classesPerMonth);
    }
  }
  if (months == null && src.clasesTotales) {
    months = Math.ceil(src.clasesTotales / REFERENCE_CLASSES_PER_MONTH);
  }
  if (months == null) months = 6;

  return {
    nombreCompleto,
    metaLabel,
    ritmoLabel,
    fechaConversion: formatFecha(src.fechaConversion),
    fechaLlegada:    fechaLlegadaFromMonths(src.fechaConversion, months),
    fechaEmision:    formatFecha(new Date()),
  };
}

export type IssuedGarantia = {
  certId:    string;
  numero:    string;
  pdfBuffer: Buffer;
  vars:      GarantiaPdfVars;
  /** true si el certificado ya existía (PDF regenerado, no re-emitido). */
  alreadyExisted: boolean;
};

/**
 * Emite (si no existe ya) la Garantía de Nivel para un estudiante.
 * Idempotente: si el estudiante ya tiene un certificado garantia_nivel,
 * devuelve el existente regenerando el PDF con su metadata.
 */
export async function issueGarantiaCertificate(opts: {
  studentId:      string;
  nombreCompleto: string;
  source:         GarantiaSource;
}): Promise<IssuedGarantia | null> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("certificates")
    .select("id, extra_label, description, date_from, date_to, issued_at")
    .eq("student_id", opts.studentId)
    .eq("type", "garantia_nivel")
    .maybeSingle();

  if (existing) {
    const ex = existing as {
      id: string; extra_label: string | null; description: string | null;
      date_from: string | null; date_to: string | null; issued_at: string;
    };
    const [metaLabel, ritmoLabel] = (ex.description ?? " · ").split(" · ");
    const issued = new Date(ex.issued_at);
    const llegada = ex.date_to ? new Date(ex.date_to + "T00:00:00Z") : null;
    const vars: GarantiaPdfVars = {
      nombreCompleto:  opts.nombreCompleto,
      metaLabel:       metaLabel || "tu nivel objetivo",
      ritmoLabel:      ritmoLabel || "Pago único",
      fechaConversion: ex.date_from ? formatFecha(new Date(ex.date_from + "T00:00:00Z")) : formatFecha(issued),
      fechaLlegada:    llegada
        ? `${MONTH_NAMES[llegada.getUTCMonth()]} de ${llegada.getUTCFullYear()}`
        : "",
      idUnico:         ex.extra_label ?? ex.id,
      fechaEmision:    formatFecha(issued),
    };
    return {
      certId: ex.id,
      numero: vars.idUnico,
      pdfBuffer: await buildGarantiaPdf(vars),
      vars,
      alreadyExisted: true,
    };
  }

  const resolved = resolveGarantiaVars(opts.nombreCompleto, opts.source);

  // Nº secuencial GN-YYYY-NNNNN vía RPC (migración 107).
  const { data: numData, error: numErr } = await sb.rpc("next_garantia_number");
  if (numErr || !numData) {
    console.error("[garantia-cert] next_garantia_number failed:", numErr?.message);
    return null;
  }
  const numero = numData as string;

  const llegadaIdx = MONTH_NAMES.indexOf(resolved.fechaLlegada.split(" de ")[0]);
  const llegadaYear = Number(resolved.fechaLlegada.split(" de ")[1]);
  const dateTo = llegadaIdx >= 0 && Number.isFinite(llegadaYear)
    ? new Date(Date.UTC(llegadaYear, llegadaIdx, 1)).toISOString().slice(0, 10)
    : null;

  const { data: inserted, error: insErr } = await sb
    .from("certificates")
    .insert({
      student_id:  opts.studentId,
      type:        "garantia_nivel",
      title:       "Garantía de Nivel por Escrito",
      description: `${resolved.metaLabel} · ${resolved.ritmoLabel}`,
      extra_label: numero,
      date_from:   opts.source.fechaConversion.toISOString().slice(0, 10),
      date_to:     dateTo,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[garantia-cert] insert failed:", insErr?.message);
    return null;
  }

  const vars: GarantiaPdfVars = { ...resolved, idUnico: numero };
  return {
    certId:    (inserted as { id: string }).id,
    numero,
    pdfBuffer: await buildGarantiaPdf(vars),
    vars,
    alreadyExisted: false,
  };
}
