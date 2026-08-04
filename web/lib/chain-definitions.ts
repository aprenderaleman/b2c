/**
 * Definiciones declarativas de las 6 cadenas de mensajes post-trial.
 *
 * Cada cadena es un array de pasos con:
 *   - delayMs: milisegundos desde chain.started_at
 *   - templateKind: clave en message_templates (kind)
 *   - templateSubN: sub-secuencia en message_templates (sub_n)
 *   - channels: por dónde enviar
 *   - skipIfPaid: si es true, el step se salta cuando el lead ya pagó
 *   - onComplete: acciones al terminar este paso (último paso de la cadena)
 *   - closerTask: si se define, genera una tarea de closer al ejecutar este step
 */

export type ChainType =
  | "chain1_attended"
  | "chain2_link_sent"
  | "chain3_obj_precio"
  | "chain3_obj_pensarlo"
  | "chain3_obj_pareja"
  | "chain3_obj_tiempo"
  | "chain4_absent"
  | "chain5_reschedule"
  | "chain6_cancel"
  | "chain8a_agendar"
  | "chain8b_no_contesto"
  | "chain8c_info"
  | "chain8d_propuesta"
  | "chain8e_seguimiento"
  | "chain8g_reactivacion";

export type ObjectionChip = "precio" | "pensarlo" | "pareja" | "tiempo";

export const OBJECTION_CHIP_TO_CHAIN: Record<ObjectionChip, ChainType> = {
  precio:   "chain3_obj_precio",
  pensarlo: "chain3_obj_pensarlo",
  pareja:   "chain3_obj_pareja",
  tiempo:   "chain3_obj_tiempo",
};

export type CloserTaskDef = {
  tipo: string;
  description: string;
  delayHours: number;
  venceEnHours: number;
  prioridad: "alta" | "media";
};

export type ChainStep = {
  delayMs: number;
  templateKind: string;
  templateSubN: number;
  channels: ("whatsapp" | "email")[];
  skipIfPaid?: boolean;
  onComplete?: {
    setStatus?: string;
  };
  closerTask?: CloserTaskDef;
  adminAlert?: boolean;
};

export type ChainDef = {
  type: ChainType;
  label: string;
  steps: ChainStep[];
};

const H  = 3_600_000;
const D  = 86_400_000;

export const CHAIN_DEFINITIONS: Record<ChainType, ChainDef> = {
  chain1_attended: {
    type: "chain1_attended",
    label: "Asistió (general)",
    steps: [
      {
        // Gelfis 2026-08-04: T+2h se percibía muy rápido. T+6h da aire
        // sin perder el momentum de la clase.
        delayMs: 6 * H,
        templateKind: "chain1_attended",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_post",
          description: "Llamada de seguimiento post-clase",
          delayHours: 24,
          venceEnHours: 24,
          prioridad: "media",
        },
      },
      { delayMs: 24 * H, templateKind: "chain1_attended", templateSubN: 2, channels: ["whatsapp"] },
      { delayMs: 47 * H, templateKind: "chain1_attended", templateSubN: 3, channels: ["whatsapp"] },
      { delayMs: 5 * D,  templateKind: "chain1_attended", templateSubN: 4, channels: ["whatsapp"] },
      {
        delayMs: 9 * D,
        templateKind: "chain1_attended",
        templateSubN: 5,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain2_link_sent: {
    type: "chain2_link_sent",
    label: "Enlace de inscripción enviado",
    steps: [
      {
        delayMs: 3 * H,
        templateKind: "chain2_link_sent",
        templateSubN: 2,
        channels: ["whatsapp"],
        skipIfPaid: true,
        closerTask: {
          tipo: "llamada_rescate",
          description: "Llamada de rescate de venta — enlace sin pagar",
          delayHours: 0,
          venceEnHours: 2,
          prioridad: "alta",
        },
      },
      {
        delayMs: 24 * H,
        templateKind: "chain2_link_sent",
        templateSubN: 3,
        channels: ["whatsapp"],
        skipIfPaid: true,
      },
      {
        delayMs: 48 * H,
        templateKind: "chain2_link_sent",
        templateSubN: 4,
        channels: ["whatsapp"],
        skipIfPaid: true,
        adminAlert: true,
      },
    ],
  },

  chain3_obj_precio: {
    type: "chain3_obj_precio",
    label: "Objeción: Precio",
    steps: [
      {
        delayMs: 2 * H,
        templateKind: "chain3_obj_precio",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "llamada_objecion",
          description: "Llamada post-clase — objeción: Precio",
          delayHours: 0,
          venceEnHours: 4,
          prioridad: "alta",
        },
      },
      { delayMs: 2 * D,  templateKind: "chain3_obj_precio", templateSubN: 2, channels: ["whatsapp"] },
      {
        delayMs: 5 * D,
        templateKind: "chain3_obj_precio",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain3_obj_pensarlo: {
    type: "chain3_obj_pensarlo",
    label: "Objeción: Pensarlo",
    steps: [
      {
        delayMs: 24 * H,
        templateKind: "chain3_obj_pensarlo",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "llamada_objecion",
          description: "Llamada post-clase — objeción: Pensarlo",
          delayHours: 0,
          venceEnHours: 4,
          prioridad: "alta",
        },
      },
      { delayMs: 47 * H, templateKind: "chain3_obj_pensarlo", templateSubN: 2, channels: ["whatsapp"] },
      {
        delayMs: 5 * D,
        templateKind: "chain3_obj_pensarlo",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain3_obj_pareja: {
    type: "chain3_obj_pareja",
    label: "Objeción: Pareja/familia",
    steps: [
      {
        delayMs: 2 * H,
        templateKind: "chain3_obj_pareja",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "llamada_objecion",
          description: "Llamada post-clase — objeción: Pareja/familia",
          delayHours: 0,
          venceEnHours: 4,
          prioridad: "alta",
        },
      },
      { delayMs: 2 * D,  templateKind: "chain3_obj_pareja", templateSubN: 2, channels: ["whatsapp"] },
      {
        delayMs: 5 * D,
        templateKind: "chain3_obj_pareja",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain3_obj_tiempo: {
    type: "chain3_obj_tiempo",
    label: "Objeción: Tiempo",
    steps: [
      {
        delayMs: 24 * H,
        templateKind: "chain3_obj_tiempo",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "llamada_objecion",
          description: "Llamada post-clase — objeción: Tiempo",
          delayHours: 0,
          venceEnHours: 4,
          prioridad: "alta",
        },
      },
      { delayMs: 47 * H, templateKind: "chain3_obj_tiempo", templateSubN: 2, channels: ["whatsapp"] },
      {
        delayMs: 5 * D,
        templateKind: "chain3_obj_tiempo",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain4_absent: {
    type: "chain4_absent",
    label: "No asistió",
    steps: [
      {
        delayMs: 20 * 60_000,
        templateKind: "chain4_absent",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_absent",
          description: "Seguimiento lead ausente",
          delayHours: 24,
          venceEnHours: 24,
          prioridad: "media",
        },
      },
      { delayMs: 24 * H, templateKind: "chain4_absent", templateSubN: 2, channels: ["whatsapp"] },
      {
        delayMs: 3 * D,
        templateKind: "chain4_absent",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain5_reschedule: {
    type: "chain5_reschedule",
    label: "Reprogramar",
    steps: [],
  },

  chain6_cancel: {
    type: "chain6_cancel",
    label: "Cancelar",
    steps: [
      { delayMs: 1 * H, templateKind: "chain6_cancel", templateSubN: 1, channels: ["whatsapp"] },
      {
        delayMs: 7 * D,
        templateKind: "chain6_cancel",
        templateSubN: 2,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  // ── Closer Layer 2 chains ─────────────────────────────────────────

  chain8a_agendar: {
    type: "chain8a_agendar",
    label: "Closer: Agendar clase",
    steps: [
      {
        delayMs: 24 * H,
        templateKind: "chain8a_agendar",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_post",
          description: "Confirmar asistencia a clase agendada",
          delayHours: 24,
          venceEnHours: 12,
          prioridad: "media",
        },
      },
    ],
  },

  chain8b_no_contesto: {
    type: "chain8b_no_contesto",
    label: "Closer: No contestó",
    steps: [
      {
        delayMs: 4 * H,
        templateKind: "chain8b_no_contesto",
        templateSubN: 1,
        channels: ["whatsapp"],
      },
      {
        delayMs: 24 * H,
        templateKind: "chain8b_no_contesto",
        templateSubN: 2,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_post",
          description: "Segundo intento de contacto",
          delayHours: 0,
          venceEnHours: 8,
          prioridad: "media",
        },
      },
      {
        delayMs: 3 * D,
        templateKind: "chain8b_no_contesto",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain8c_info: {
    type: "chain8c_info",
    label: "Closer: Info enviada",
    steps: [
      {
        delayMs: 24 * H,
        templateKind: "chain8c_info",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_post",
          description: "Seguimiento tras envío de info",
          delayHours: 24,
          venceEnHours: 12,
          prioridad: "media",
        },
      },
    ],
  },

  chain8d_propuesta: {
    type: "chain8d_propuesta",
    label: "Closer: Propuesta enviada",
    steps: [
      {
        delayMs: 24 * H,
        templateKind: "chain8d_propuesta",
        templateSubN: 1,
        channels: ["whatsapp"],
        closerTask: {
          tipo: "seguimiento_post",
          description: "Seguimiento propuesta enviada",
          delayHours: 0,
          venceEnHours: 8,
          prioridad: "alta",
        },
      },
      {
        delayMs: 3 * D,
        templateKind: "chain8d_propuesta",
        templateSubN: 2,
        channels: ["whatsapp"],
      },
      {
        delayMs: 5 * D,
        templateKind: "chain8d_propuesta",
        templateSubN: 3,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },

  chain8e_seguimiento: {
    type: "chain8e_seguimiento",
    label: "Closer: Seguimiento con fecha",
    steps: [
      {
        delayMs: 0,
        templateKind: "chain8e_seguimiento",
        templateSubN: 1,
        channels: ["whatsapp"],
      },
    ],
  },

  chain8g_reactivacion: {
    type: "chain8g_reactivacion",
    label: "Closer: Reactivación",
    steps: [
      {
        delayMs: 0,
        templateKind: "chain8g_reactivacion",
        templateSubN: 1,
        channels: ["whatsapp"],
      },
      {
        delayMs: 4 * D,
        templateKind: "chain8g_reactivacion",
        templateSubN: 2,
        channels: ["whatsapp"],
        onComplete: { setStatus: "en_reactivacion" },
      },
    ],
  },
};

export function getChainDef(type: ChainType): ChainDef {
  return CHAIN_DEFINITIONS[type];
}
