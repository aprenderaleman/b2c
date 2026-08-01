import { supabaseAdmin } from "./supabase";
import { completeTask, cancelPendingTasks } from "./closer-cadence";
import { logCloserAction, markLeadLostByCloser } from "./closer-actions";
import { cancelActiveChain, pauseChain } from "./chain-engine";

export type ActionResultado =
  | "contactado"
  | "no_contesto"
  | "buzon"
  | "reagendado"
  | "venta"
  | "no_interesado";

export type ProcessActionArgs = {
  taskId: string;
  closerId: string;
  leadId: string;
  resultado: ActionResultado;
  objectionChip?: string | null;
  motivoNoInteresado?: string | null;
  nota?: string | null;
};

export async function processActionResult(args: ProcessActionArgs): Promise<void> {
  const sb = supabaseAdmin();

  const { data: task } = await sb
    .from("tareas_closer")
    .select("canal, tipo")
    .eq("id", args.taskId)
    .single();

  const canal = (task as { canal?: string })?.canal ?? "llamada";
  const accionTipo = canal === "whatsapp" ? "whatsapp" : canal === "email" ? "email" : "llamada";

  await completeTask(args.taskId, args.resultado as "contactado" | "no_contesto" | "no_interesado" | "reagendado" | "venta", args.nota ?? undefined);

  const insertFields: Record<string, unknown> = {
    closer_id: args.closerId,
    lead_id: args.leadId,
    tipo: args.resultado,
    contenido: args.nota ?? null,
    resultado: args.resultado,
  };
  if (args.objectionChip) insertFields.objection_chip = args.objectionChip;
  if (args.motivoNoInteresado) insertFields.motivo_no_interesado = args.motivoNoInteresado;

  const { data: accionRow } = await sb
    .from("acciones_closer")
    .insert(insertFields)
    .select("id")
    .single();

  await sb.from("lead_timeline").insert({
    lead_id: args.leadId,
    type: "agent_note",
    author: "closer",
    content: buildTimelineContent(args),
    metadata: {
      kind: "closer_action",
      closer_id: args.closerId,
      accion_id: accionRow?.id,
      resultado: args.resultado,
      objection_chip: args.objectionChip ?? null,
    },
  });

  // R2: human kills automatic — any closer action cancels the active chain
  switch (args.resultado) {
    case "contactado":
      await cancelActiveChain(args.leadId, "closer_action_r2").catch(() => {});
      break;

    case "no_contesto":
    case "buzon":
      await cancelActiveChain(args.leadId, "closer_action_r2").catch(() => {});
      break;

    case "reagendado":
      await cancelActiveChain(args.leadId, "closer_action_r2").catch(() => {});
      break;

    case "no_interesado": {
      const motivo = args.motivoNoInteresado ?? "No interesado";
      await cancelPendingTasks(args.leadId);
      await cancelActiveChain(args.leadId, `closer_no_interesado: ${motivo}`);
      await markLeadLostByCloser(args.leadId, args.closerId, motivo);
      break;
    }

    case "venta":
      await cancelActiveChain(args.leadId, "closer_action_r2").catch(() => {});
      break;
  }
}

function buildTimelineContent(args: ProcessActionArgs): string {
  const parts: string[] = [];

  switch (args.resultado) {
    case "contactado":
      parts.push("Contactado");
      if (args.objectionChip) parts.push(`(objecion: ${args.objectionChip})`);
      break;
    case "no_contesto":
      parts.push("No contesto");
      break;
    case "buzon":
      parts.push("Buzon de voz");
      break;
    case "reagendado":
      parts.push("Reagendado");
      break;
    case "venta":
      parts.push("Venta registrada");
      break;
    case "no_interesado":
      parts.push("No interesado");
      if (args.motivoNoInteresado) parts.push(`(${args.motivoNoInteresado})`);
      break;
  }

  if (args.nota) parts.push(`— ${args.nota}`);

  return parts.join(" ");
}
