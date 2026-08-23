import { supabaseAdmin } from "./supabase";
import { startChain, cancelActiveChain } from "./chain-engine";
import { logCloserAction } from "./closer-actions";
import { resolveChainVariables } from "./chain-variables";
import { renderTemplate } from "./message-stats";
import { RITMOS, type RitmoId } from "./trial-packs";

export type Layer2ActionType =
  | "agendar"
  | "no_contesto"
  | "enviar_info"
  | "enviar_propuesta"
  | "seguimiento_fecha"
  | "enviar_enlace"
  | "confirmar_pago"
  | "pasar_reactivacion";

export type Layer2ActionArgs = {
  closerId: string;
  leadId: string;
  action: Layer2ActionType;
  ritmoId?: RitmoId;
  goalId?: string;
  fecha?: string;
  nota?: string;
};

export type Layer2Result = {
  ok: true;
  message?: string;
  chainStarted?: string;
} | {
  ok: false;
  error: string;
};

export async function processLayer2Action(args: Layer2ActionArgs): Promise<Layer2Result> {
  switch (args.action) {
    case "agendar":
      return handleAgendar(args);
    case "no_contesto":
      return handleNoContesto(args);
    case "enviar_info":
      return handleEnviarInfo(args);
    case "enviar_propuesta":
      return handleEnviarPropuesta(args);
    case "seguimiento_fecha":
      return handleSeguimientoFecha(args);
    case "pasar_reactivacion":
      return handlePasarReactivacion(args);
    case "confirmar_pago":
      return { ok: true, message: "Usa el flujo de ventas existente" };
    case "enviar_enlace":
      return { ok: true, message: "Usa el endpoint send-offer del closer" };
    default:
      return { ok: false, error: "unknown_action" };
  }
}

async function handleAgendar(args: Layer2ActionArgs): Promise<Layer2Result> {
  const chainId = await startChain(args.leadId, "chain8a_agendar", {}, { bypassGateOnStart: true });
  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "nota",
    contenido: "Agendó nueva clase",
    resultado: "reagendado",
  });
  return { ok: true, chainStarted: chainId ?? undefined };
}

async function handleNoContesto(args: Layer2ActionArgs): Promise<Layer2Result> {
  const chainId = await startChain(args.leadId, "chain8b_no_contesto", {}, { bypassGateOnStart: true });
  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "whatsapp",
    contenido: args.nota ?? "Mensaje 'no contestó' enviado",
    resultado: "mensaje_enviado",
  });
  return { ok: true, chainStarted: chainId ?? undefined };
}

async function handleEnviarInfo(args: Layer2ActionArgs): Promise<Layer2Result> {
  const chainId = await startChain(args.leadId, "chain8c_info", {}, { bypassGateOnStart: true });
  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "whatsapp",
    contenido: args.nota ?? "Info de cursos enviada",
    resultado: "mensaje_enviado",
  });
  return { ok: true, chainStarted: chainId ?? undefined };
}

async function handleEnviarPropuesta(args: Layer2ActionArgs): Promise<Layer2Result> {
  if (!args.ritmoId) return { ok: false, error: "missing_ritmo" };

  const ritmo = RITMOS.find(r => r.id === args.ritmoId);
  if (!ritmo) return { ok: false, error: "invalid_ritmo" };

  const chainId = await startChain(args.leadId, "chain8d_propuesta", {
    ritmo: `${ritmo.emoji} ${ritmo.name}`,
    precio_ritmo: `${ritmo.pricePerMonth} €/mes`,
    packId: ritmo.id,
  }, { bypassGateOnStart: true });

  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "whatsapp",
    contenido: `Propuesta enviada: ${ritmo.name} (${ritmo.pricePerMonth} €/mes)`,
    resultado: "mensaje_enviado",
  });

  return { ok: true, chainStarted: chainId ?? undefined };
}

async function handleSeguimientoFecha(args: Layer2ActionArgs): Promise<Layer2Result> {
  if (!args.fecha) return { ok: false, error: "missing_fecha" };

  // R2: cancel existing chain before manual scheduling
  await cancelActiveChain(args.leadId, "closer_action_r2").catch(() => {});

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("closer_id")
    .eq("id", args.leadId)
    .single();

  const closerId = (lead as { closer_id: string | null })?.closer_id ?? args.closerId;

  await sb.from("tareas_closer").insert({
    closer_id: closerId,
    lead_id: args.leadId,
    paso: 1,
    tipo: "seguimiento_fecha",
    canal: "llamada",
    plantilla: `Seguimiento programado: ${args.nota ?? "seguimiento"}`,
    fecha_programada: new Date(args.fecha).toISOString(),
    prioridad: "media",
    origen: "manual",
  });

  // Estado derivado: la acción 📅 pacta un seguimiento — se libera solo
  // al registrar el siguiente resultado (processActionResult).
  await sb.from("leads").update({ estado_cierre: "seguimiento_pactado" }).eq("id", args.leadId);

  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "nota",
    contenido: `Seguimiento programado para ${args.fecha}${args.nota ? `: ${args.nota}` : ""}`,
    resultado: "reagendado",
  });

  return { ok: true };
}

async function handlePasarReactivacion(args: Layer2ActionArgs): Promise<Layer2Result> {
  const sb = supabaseAdmin();

  const chainId = await startChain(args.leadId, "chain8g_reactivacion", {}, { bypassGateOnStart: true });

  await sb.from("leads").update({
    estado_cierre: "en_reactivacion",
  }).eq("id", args.leadId);

  await logCloserAction({
    closerId: args.closerId,
    leadId: args.leadId,
    tipo: "whatsapp",
    contenido: args.nota ?? "Pasado a reactivación",
    resultado: "mensaje_enviado",
  });

  await sb.from("lead_timeline").insert({
    lead_id: args.leadId,
    type: "status_change",
    author: "closer",
    content: "Lead pasado a reactivación por el closer",
    metadata: { kind: "closer_reactivacion", chain_id: chainId },
  });

  return { ok: true, chainStarted: chainId ?? undefined };
}

export async function resolveMessageForCloser(
  leadId: string,
  templateKind: string,
  subN: number = 1,
  extraMeta: Record<string, unknown> = {},
): Promise<string | null> {
  const sb = supabaseAdmin();

  const { data: tplRow } = await sb
    .from("message_templates")
    .select("body")
    .eq("kind", templateKind)
    .eq("sub_n", subN)
    .eq("channel", "whatsapp")
    .eq("active", true)
    .maybeSingle();

  if (!tplRow || !(tplRow as { body?: string }).body) return null;

  const vars = await resolveChainVariables(leadId, extraMeta, new Date().toISOString());
  return renderTemplate((tplRow as { body: string }).body, vars);
}
