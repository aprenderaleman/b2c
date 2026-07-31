import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getLeadTasks } from "@/lib/closer-cadence";
import { redirect } from "next/navigation";
import { CloserLeadDetail } from "@/components/closer/CloserLeadDetail";

export const metadata = { title: "Lead · Closer" };

export default async function CloserLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["closer"]);
  const { id: leadId } = await params;
  const closerId = session.user.id;

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, full_name, email, whatsapp_normalized, status, estado_cierre, motivo_perdido, closer_id, fecha_asignacion_closer, created_at, meta, reserva_prioritaria, priority_deadline, deposit_intent_at, qualification_answers, landing_intent")
    .eq("id", leadId)
    .single();

  if (!lead || lead.closer_id !== closerId) redirect("/closer/leads");

  const [tasks, timelineResult, accionesResult] = await Promise.all([
    getLeadTasks(leadId),
    sb
      .from("lead_timeline")
      .select("id, type, author, content, metadata, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("acciones_closer")
      .select("id, tipo, contenido, resultado, duracion_seg, created_at")
      .eq("lead_id", leadId)
      .eq("closer_id", closerId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const timeline = timelineResult.data ?? [];
  const acciones = accionesResult.data ?? [];

  const { data: ventaPendiente } = await sb
    .from("ventas")
    .select("id, pack_id, payment_type, estado")
    .eq("lead_id", leadId)
    .eq("estado", "pendiente")
    .maybeSingle();

  return (
    <main className="space-y-5">
      <CloserLeadDetail
        lead={lead}
        tasks={tasks}
        timeline={timeline}
        acciones={acciones}
        ventaPendiente={ventaPendiente}
      />
    </main>
  );
}
