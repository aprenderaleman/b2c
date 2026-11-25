import { supabaseAdmin } from "./supabase";
import { completeTask, cancelPendingTasks } from "./closer-cadence";
import { logCloserAction, markLeadLostByCloser } from "./closer-actions";
import { cancelActiveChain, pauseChain } from "./chain-engine";
import { ensureFuturePlay } from "./semaforo";

export type ActionResultado =
  | "contactado"
  | "no_contesto"
  | "buzon"
  | "reagendado"
  | "venta"
  | "no_interesado";

export type ProcessActionArgs = {
  /** null → registro directo sobre el lead, sin tarea asociada */
  taskId: string | null;
  closerId: string;
  leadId: string;
  resultado: ActionResultado;
  objectionChip?: string | null;
  motivoNoInteresado?: string | null;
  nota?: string | null;
  /** ISO — cuándo ocurrió realmente el contacto (≤48h atrás) */
  occurredAt?: string | null;
};

/**
 * Valida el "cuándo ocurrió" de una acción del closer: como máximo 48h
 * hacia atrás (misma ventana que registerContact) y nunca en el futuro.
 * Devuelve el ISO normalizado, null si no se envió, o un error.
 */
export function parseOccurredAt(
  input: string | null | undefined,
): { iso: string | null } | { error: string } {
  if (!input) return { iso: null };
  const d = new Date(input);
  if (isNaN(d.getTime())) return { error: "occurred_at_invalid" };
  const now = Date.now();
  if (d.getTime() > now + 5 * 60_000) return { error: "occurred_at_future" };
  if (d.getTime() < now - 48 * 3_600_000) return { error: "occurred_at_too_old" };
  return { iso: d.toISOString() };
}

export async function processActionResult(args: ProcessActionArgs): Promise<void> {
  const sb = supabaseAdmin();

  if (args.taskId) {
    await completeTask(args.taskId, args.resultado as "contactado" | "no_contesto" | "no_interesado" | "reagendado" | "venta", args.nota ?? undefined);
  }

  const insertFields: Record<string, unknown> = {
    closer_id: args.closerId,
    lead_id: args.leadId,
    tipo: args.resultado,
    contenido: args.nota ?? null,
    resultado: args.resultado,
  };
  if (args.objectionChip) insertFields.objection_chip = args.objectionChip;
  if (args.motivoNoInteresado) insertFields.motivo_no_interesado = args.motivoNoInteresado;
  if (args.occurredAt) insertFields.occurred_at = args.occurredAt;

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

  // El "seguimiento pactado" se consume al registrar cualquier resultado:
  // el lead vuelve a estado activo (derivación automática, sin edición manual).
  if (args.resultado !== "no_interesado") {
    await sb
      .from("leads")
      .update({ estado_cierre: "activo" })
      .eq("id", args.leadId)
      .eq("estado_cierre", "seguimiento_pactado");
  }

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

  // Anti-limbo (semáforo global, spec sección 3): si tras la acción el
  // lead activo queda sin tarea futura ni cadena ni cita → auto-tarea
  // "Seguimiento" +3d. Constraint del flujo de guardado, no sugerencia.
  if (args.resultado !== "no_interesado") {
    await ensureFuturePlay(args.leadId).catch(() => {});
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
