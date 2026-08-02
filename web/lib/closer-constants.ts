import type { TareaCloser } from "./closer-cadence";

/* ── Tipo badges (shared by dashboard + inbox) ── */

export const TIPO_LABEL: Record<string, { text: string; cls: string }> = {
  tipo_a: { text: "Tipo A", cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30" },
  tipo_b: { text: "Tipo B", cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  seguimiento_post: { text: "Seguimiento", cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" },
  llamada_rescate: { text: "Rescate", cls: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30" },
  llamada_objecion: { text: "Objecion", cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  seguimiento_absent: { text: "No-show", cls: "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30" },
  inbound_response: { text: "Inbound", cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30" },
  reactivacion: { text: "Reactivacion", cls: "bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30" },
};

export const CANAL_ICON: Record<string, string> = {
  whatsapp: "WA",
  llamada: "Tel",
  email: "Em",
};

/* ── Priority sorting ── */

export function taskPriorityScore(task: TareaCloser): number {
  if (task.tipo === "llamada_rescate") return 0;
  if (task.lead_reserva_prioritaria || task.lead_priority_deadline === "concrete") return 1;
  if (task.tipo === "llamada_objecion") return 2;
  if (task.prioridad === "alta") return 3;
  if (task.tipo === "inbound_response") return 4;
  return 5;
}

export function sortByPriority(tasks: TareaCloser[]): TareaCloser[] {
  return [...tasks].sort((a, b) => {
    const pa = taskPriorityScore(a);
    const pb = taskPriorityScore(b);
    if (pa !== pb) return pa - pb;
    return new Date(a.fecha_programada).getTime() - new Date(b.fecha_programada).getTime();
  });
}

/* ── Time helpers ── */

export function hoursLate(fechaProgramada: string): string {
  const diff = Date.now() - new Date(fechaProgramada).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ── Source badges (light/dark adapted from admin LANDING_META) ── */

type SourceMeta = { label: string; sourceLabel: string; sourceIcon: string; sourceCls: string };
const SRC_ADS       = "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30";
const SRC_SOCIAL    = "bg-purple-50  dark:bg-purple-500/10  text-purple-700  dark:text-purple-300  border-purple-200  dark:border-purple-500/30";
const SRC_DIRECT    = "bg-sky-50     dark:bg-sky-500/10     text-sky-700     dark:text-sky-300     border-sky-200     dark:border-sky-500/30";
const SRC_YOUTUBE   = "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30";
const SRC_INSTAGRAM = "bg-pink-50    dark:bg-pink-500/10    text-pink-700    dark:text-pink-300    border-pink-200    dark:border-pink-500/30";
const SRC_TIKTOK    = "bg-slate-100  dark:bg-slate-800      text-slate-700   dark:text-slate-100   border-slate-300   dark:border-slate-500/30";
const SRC_FACEBOOK  = "bg-blue-50    dark:bg-blue-500/10    text-blue-700    dark:text-blue-300    border-blue-200    dark:border-blue-500/30";
const SRC_META_ADS  = "bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-500/30";
const SRC_OTHER     = "bg-slate-50   dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700";

export const SOURCE_META: Record<string, SourceMeta> = {
  "socialmedia":            { label: "Home (redes sociales)",       sourceLabel: "Social",    sourceIcon: "📱", sourceCls: SRC_SOCIAL    },
  "home":                   { label: "Home (legacy)",               sourceLabel: "Social",    sourceIcon: "📱", sourceCls: SRC_SOCIAL    },
  "curso-online":           { label: "Curso de alemán online",      sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "particulares":           { label: "Clases particulares",         sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "intensivo":              { label: "Curso intensivo",             sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "certificado":            { label: "Certificado oficial",         sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "b2-trabajar":            { label: "B2 para trabajar",            sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "clases-aleman-ciudades": { label: "Clases por ciudades",         sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "ciudades":               { label: "Clases por ciudades",         sourceLabel: "Ads",       sourceIcon: "🟢", sourceCls: SRC_ADS       },
  "youtube":                { label: "YouTube (descripciones)",     sourceLabel: "YouTube",   sourceIcon: "📺", sourceCls: SRC_YOUTUBE   },
  "instagram":              { label: "Instagram (bio + stories)",   sourceLabel: "Instagram", sourceIcon: "📸", sourceCls: SRC_INSTAGRAM },
  "tiktok":                 { label: "TikTok (bio link)",           sourceLabel: "TikTok",    sourceIcon: "🎵", sourceCls: SRC_TIKTOK    },
  "facebook":               { label: "Facebook (orgánico)",         sourceLabel: "Facebook",  sourceIcon: "📘", sourceCls: SRC_FACEBOOK  },
  "meta-ads":               { label: "Meta Ads (FB + IG pagado)",   sourceLabel: "Meta Ads",  sourceIcon: "💰", sourceCls: SRC_META_ADS  },
  "meta-ads-paid":          { label: "Meta Ads · 10€ depósito",     sourceLabel: "Meta Paid", sourceIcon: "💎", sourceCls: SRC_META_ADS  },
  "agendar-directo":        { label: "Atajo CTA verde",             sourceLabel: "Directo",   sourceIcon: "⚡", sourceCls: SRC_DIRECT    },
  "(sin landing)":          { label: "(sin atribución)",            sourceLabel: "Otro",      sourceIcon: "❓", sourceCls: SRC_OTHER     },
};

/* ── Formatting helpers ── */

export function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)    return "ahora mismo";
  if (min < 60)   return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24)    return `hace ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30)     return `hace ${d}d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function fmtTrialDate(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ── Layer2 action definitions ── */

export type RitmoOption = {
  id: string;
  name: string;
  emoji: string;
  pricePerMonth: number;
};

export const RITMOS: RitmoOption[] = [
  { id: "viajero", name: "Viajero", emoji: "\u{1f30d}", pricePerMonth: 240 },
  { id: "estandar", name: "Estandar", emoji: "⭐", pricePerMonth: 320 },
  { id: "intensivo", name: "Intensivo", emoji: "\u{1f525}", pricePerMonth: 450 },
  { id: "vip_express", name: "VIP Express", emoji: "\u{1f680}", pricePerMonth: 690 },
];

export type ActionButton = {
  action: string;
  label: string;
  icon: string;
  description: string;
  isCopy?: boolean;
  needsRitmo?: boolean;
  needsFecha?: boolean;
  isLink?: boolean;
};

export const ACTION_BUTTONS: ActionButton[] = [
  { action: "agendar", label: "Agendar", icon: "\u{1f4c5}", description: "Iniciar cadena de agendamiento" },
  { action: "no_contesto", label: "No contesto", icon: "\u{1f4f5}", description: "Cadena de seguimiento", isCopy: true },
  { action: "enviar_info", label: "Enviar info", icon: "\u{1f4cb}", description: "Info de cursos", isCopy: true },
  { action: "enviar_propuesta", label: "Propuesta", icon: "\u{1f4b0}", description: "Seleccionar ritmo", needsRitmo: true },
  { action: "seguimiento_fecha", label: "Seguimiento", icon: "\u{1f4c6}", description: "Programar seguimiento", needsFecha: true },
  { action: "enviar_enlace", label: "Enlace", icon: "\u{1f517}", description: "Enlace de inscripcion", isLink: true },
  { action: "confirmar_pago", label: "Confirmar pago", icon: "✅", description: "Verificar pago" },
  { action: "pasar_reactivacion", label: "Reactivacion", icon: "\u{1f504}", description: "Pasar a reactivacion", isCopy: true },
];

/* ── Task type → template action mapping (for inline message preview) ── */

export const TASK_TO_TEMPLATE_ACTION: Record<string, string> = {
  tipo_a: "enviar_info",
  tipo_b: "no_contesto",
  seguimiento_post: "enviar_info",
  llamada_rescate: "no_contesto",
  llamada_objecion: "no_contesto",
  inbound_response: "enviar_info",
  reactivacion: "pasar_reactivacion",
  seguimiento_absent: "no_contesto",
};
