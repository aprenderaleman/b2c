/**
 * Stats de efectividad de plantillas de mensajes.
 *
 * Definición de "respondido": tras un `system_message_sent` de un kind X
 * a un lead, el MISMO lead emite un `lead_message_received` dentro de
 * los siguientes 7 días naturales. Eso vale como reacción.
 *
 * Calculado on-the-fly contra lead_timeline — no se persiste para que
 * las estadísticas siempre reflejen la realidad actual.
 *
 * Catálogo de plantillas: lib/message-catalog.ts (override editable en
 * tabla message_templates).
 */

import { supabaseAdmin } from "./supabase";

export type MessageStats = {
  kind:          string;
  channel:       string;
  sub_n:         number | null;      // sub-secuencia (1..N) o null si es único
  sent:          number;             // TODOS los envios en la ventana
  sentMature:    number;             // envios con >=7d para que el lead haya podido responder
  responded7d:   number;             // respuestas (solo cuenta sobre sentMature para evitar survivorship)
  responseRate:  number;             // 0..100, calculada sobre sentMature
  lastSentAt:    string | null;
  samples:       Array<{ at: string; preview: string; isRealBody: boolean }>;  // 3 más recientes
  // Flags de fiabilidad de la metrica para que la UI los marque:
  reliability:   {
    emailBlind:        boolean;   // canal email puro → respuestas no trackeadas
    immatureCohort:    boolean;   // mucha % de envios <7d → tasa subestimada
    summaryContent:    boolean;   // samples son resumen, no body real
  };
};

export type StatsFilters = {
  days?:    number;   // ventana de análisis (default 90)
  channel?: string;   // filtrar por canal (whatsapp|email|both|wa+email|etc)
  kind?:    string;   // filtrar por kind exacto
};

/**
 * Devuelve stats agregadas por (kind, channel).
 */
export async function getMessageStats(filters: StatsFilters = {}): Promise<MessageStats[]> {
  const sb = supabaseAdmin();
  const days = filters.days && filters.days > 0 ? filters.days : 90;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Trabajamos en JS con datos crudos — pocas filas (<2k típicas en 90d)
  // y nos evita tocar plpgsql en runtime.
  let q = sb
    .from("lead_timeline")
    .select("lead_id, timestamp, metadata, content")
    .eq("type", "system_message_sent")
    .gte("timestamp", since);
  const { data: sentRows } = await q;

  // Saca todos los inbound del rango para hacer el match en JS.
  const { data: inboundRows } = await sb
    .from("lead_timeline")
    .select("lead_id, timestamp")
    .eq("type", "lead_message_received")
    .gte("timestamp", since);

  // Index inbound por lead → lista de timestamps (ms)
  const inboundByLead = new Map<string, number[]>();
  for (const r of (inboundRows ?? []) as Array<{ lead_id: string; timestamp: string }>) {
    const t = new Date(r.timestamp).getTime();
    const arr = inboundByLead.get(r.lead_id) ?? [];
    arr.push(t);
    inboundByLead.set(r.lead_id, arr);
  }

  type Bucket = {
    kind: string; channel: string; sub_n: number | null;
    sent: number;        // todos
    sentMature: number;  // solo los que tienen ya >=7d (ventana completa)
    responded: number;
    lastSentAt: string | null;
    samples: Array<{ at: string; preview: string; isRealBody: boolean }>;
  };
  const buckets = new Map<string, Bucket>();
  const WINDOW_MS = 7 * 86_400_000;
  const MATURE_CUTOFF_MS = Date.now() - WINDOW_MS;

  for (const r of (sentRows ?? []) as Array<{
    lead_id: string; timestamp: string;
    metadata: Record<string, unknown> | null; content: string | null;
  }>) {
    const md = r.metadata ?? {};
    const kind    = (md.kind    as string | undefined) ?? "(sin kind)";
    const channel = (md.channel as string | undefined) ?? "?";
    // Distintos crons usan distintos nombres para el sub-numero. Aceptamos
    // los tres y caemos a null si no esta presente.
    const rawSubN = (md.sub_n ?? md.step ?? md.message_n) as number | string | undefined;
    const sub_n   = typeof rawSubN === "number" ? rawSubN
                  : typeof rawSubN === "string" && /^\d+$/.test(rawSubN) ? parseInt(rawSubN, 10)
                  : null;
    if (filters.kind    && filters.kind    !== kind   ) continue;
    if (filters.channel && filters.channel !== channel) continue;
    const key = `${kind}::${channel}::${sub_n ?? "null"}`;
    let b = buckets.get(key);
    if (!b) {
      b = { kind, channel, sub_n, sent: 0, sentMature: 0, responded: 0, lastSentAt: null, samples: [] };
      buckets.set(key, b);
    }
    b.sent++;
    if (!b.lastSentAt || r.timestamp > b.lastSentAt) b.lastSentAt = r.timestamp;

    const content = r.content ?? "";
    // Heuristica para detectar si el content es un resumen historico
    // ("📨 Followup #N enviado") o el body real. Los envios nuevos (post
    // 2026-06-12) guardan el cuerpo completo: WhatsApp como texto plano,
    // emails con prefijo "[Email: ...]\n\n" o "[PDF ...]\n\n", contenido
    // sin "X enviado a"/"X FALLÓ" al inicio.
    const isSummary = (/^[📨📧💬📩]\s/.test(content) && /\benviado(\s|$)/.test(content.slice(0, 60)))
                      || content.startsWith("Falló")
                      || /^Email correctivo (con enlace|FALLÓ)/.test(content);
    if (b.samples.length < 3) {
      b.samples.push({
        at: r.timestamp,
        preview: content.slice(0, 200),
        isRealBody: !isSummary,
      });
    }

    const sentMs = new Date(r.timestamp).getTime();
    // sentMature: solo cuenta para la tasa los envios con >=7d, porque
    // los mas recientes aun no han tenido oportunidad de respuesta.
    const isMature = sentMs <= MATURE_CUTOFF_MS;
    if (isMature) b.sentMature++;

    const ibs = inboundByLead.get(r.lead_id) ?? [];
    if (isMature && ibs.some(t => t > sentMs && t - sentMs < WINDOW_MS)) {
      b.responded++;
    }
  }

  const out: MessageStats[] = [];
  for (const b of buckets.values()) {
    // Email-blind: el canal es email puro → respuestas no se trackean
    // en lead_message_received (que solo registra inbound WhatsApp).
    // Cualquier tasa para esta fila es engañosa.
    const emailBlind = b.channel === "email";
    // Inmaduro: si >40% de los envios estan en los ultimos 7d, la tasa
    // sobre 'sentMature' tampoco refleja bien — pero al menos no esta
    // sesgada hacia abajo. La marcamos para que la UI advierta.
    const immatureCohort = b.sent > 5 && (b.sent - b.sentMature) / b.sent > 0.4;
    // Summary content: si todos los samples son resumen (cron TS), el
    // editor no puede ensenar el body real.
    const summaryContent = b.samples.length > 0 && b.samples.every(s => !s.isRealBody);

    out.push({
      kind:          b.kind,
      channel:       b.channel,
      sub_n:         b.sub_n,
      sent:          b.sent,
      sentMature:    b.sentMature,
      responded7d:   b.responded,
      responseRate:  b.sentMature > 0 ? (100 * b.responded / b.sentMature) : 0,
      lastSentAt:    b.lastSentAt,
      samples:       b.samples.map(({ at, preview, isRealBody }) => ({ at, preview, isRealBody })),
      reliability:   { emailBlind, immatureCohort, summaryContent },
    });
  }
  // Ordenamos por volumen descendente para que arriba aparezcan los
  // que más impacto tienen.
  out.sort((a, b) => b.sent - a.sent);
  return out;
}

/**
 * Busca un template activo en BD. Devuelve null si no existe o esta
 * inactivo. Caller usa fallback hardcoded en ese caso.
 *
 * Cache en proceso de 60s: los crons que iteran sobre muchos leads
 * con el mismo kind no golpean la BD por cada lead.
 */
const _tplCache = new Map<string, { tpl: Template | null; ts: number }>();
const _TPL_TTL_MS = 60_000;

export async function getActiveTemplate(
  kind:    string,
  channel: "whatsapp" | "email" | "both",
  sub_n:   number | null = null,
): Promise<Template | null> {
  const cacheKey = `${kind}::${channel}::${sub_n ?? "null"}`;
  const now = Date.now();
  const cached = _tplCache.get(cacheKey);
  if (cached && now - cached.ts < _TPL_TTL_MS) return cached.tpl;

  const sb = supabaseAdmin();
  let q = sb.from("message_templates").select("*").eq("kind", kind).eq("channel", channel).eq("active", true);
  if (sub_n === null) q = q.is("sub_n", null);
  else                q = q.eq("sub_n", sub_n);
  const { data } = await q.maybeSingle();
  const tpl = (data as Template | null) ?? null;
  _tplCache.set(cacheKey, { tpl, ts: now });
  return tpl;
}

/**
 * Template editable persistido en BD (override de los hardcoded).
 */
export type Template = {
  id:           string;
  kind:         string;
  sub_n:        number | null;
  channel:      "whatsapp" | "email" | "both";
  name:         string;
  description:  string | null;
  body:         string;
  placeholders: string[];
  active:       boolean;
  updated_at:   string;
  updated_by:   string | null;
};

export async function listTemplates(): Promise<Template[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("message_templates")
    .select("*")
    .order("kind", { ascending: true });
  return (data ?? []) as Template[];
}

export async function upsertTemplate(input: {
  kind:         string;
  sub_n?:       number | null;
  channel:      "whatsapp" | "email" | "both";
  name:         string;
  description?: string | null;
  body:         string;
  placeholders?: string[];
  active?:      boolean;
  updatedBy:    string;
}): Promise<Template> {
  const sb = supabaseAdmin();
  const row = {
    kind:         input.kind,
    sub_n:        input.sub_n ?? null,
    channel:      input.channel,
    name:         input.name,
    description:  input.description ?? null,
    body:         input.body,
    placeholders: input.placeholders ?? [],
    active:       input.active ?? true,
    updated_at:   new Date().toISOString(),
    updated_by:   input.updatedBy,
  };
  // upsert on (kind, sub_n, channel)
  const { data, error } = await sb
    .from("message_templates")
    .upsert(row, { onConflict: "kind,sub_n,channel" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Template;
}

/**
 * Render simple: reemplaza {placeholder} por su valor.
 * Si el valor está vacío, deja el placeholder vacío (no muestra "{x}").
 */
export function renderTemplate(body: string, vars: Record<string, string | undefined | null>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v != null ? String(v) : "";
  });
}
