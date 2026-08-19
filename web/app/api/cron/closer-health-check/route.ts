import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";

/**
 * GET /api/cron/closer-health-check
 *
 * Detecta anomalías silenciosas que rompen el flujo de venta del
 * closer y envía un email si encuentra alguna:
 *
 *   A) Cadenas huérfanas: lead convertido/perdido con cadena activa
 *      → deberían haberse cancelado al cambiar de estado.
 *   B) Sesiones agendadas sin lead: classes con sesion_closer_id pero
 *      sin lead_id → el lead se borró o nunca se asoció.
 *   C) Leads activos en limbo: closer asignado, estado_cierre=activo,
 *      sin tarea futura, sin cadena activa, sin cita futura → el
 *      anti-limbo no los capturó.
 *   D) Cadenas estancadas: next_fire_at >24h en el pasado sin avanzar
 *      → el cron chain-processor no las procesa.
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

type Anomaly = {
  code: string;
  title: string;
  count: number;
  rows: Array<Record<string, unknown>>;
};

async function findAnomalies(): Promise<Anomaly[]> {
  const sb = supabaseAdmin();
  const out: Anomaly[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const ago24h = new Date(Date.now() - 24 * 3_600_000).toISOString();

  // A) Cadenas huérfanas — lead convertido/perdido con cadena activa
  const { data: orphanChains } = await sb
    .from("lead_chains")
    .select("id, lead_id, chain_type, started_at, leads!inner(id, status, estado_cierre)")
    .is("completed_at", null)
    .or("status.eq.converted,status.eq.lost,estado_cierre.eq.perdido,estado_cierre.eq.convertido", { referencedTable: "leads" })
    .limit(20);

  if (orphanChains && orphanChains.length > 0) {
    out.push({
      code: "ORPHAN_CHAIN",
      title: "Cadenas activas en leads convertidos/perdidos",
      count: orphanChains.length,
      rows: orphanChains.map((c: Record<string, unknown>) => ({
        chain_id: c.id, lead_id: c.lead_id, chain_type: c.chain_type,
        lead: c.leads,
      })),
    });
  }

  // B) Sesiones agendadas sin lead
  const { data: noLeadSessions } = await sb
    .from("classes")
    .select("id, scheduled_at, sesion_closer_id, status, lead_id")
    .not("sesion_closer_id", "is", null)
    .is("lead_id", null)
    .is("deleted_at", null)
    .in("status", ["scheduled", "live"])
    .limit(20);

  if (noLeadSessions && noLeadSessions.length > 0) {
    out.push({
      code: "SESSION_NO_LEAD",
      title: "Sesiones de plan agendadas sin lead asociado",
      count: noLeadSessions.length,
      rows: noLeadSessions as Record<string, unknown>[],
    });
  }

  // C) Leads activos en limbo — closer asignado, sin próxima jugada
  //    Usamos una query compuesta: leads activos con closer, que NO
  //    tienen tarea futura NI cadena activa.
  const { data: limboLeads } = await sb.rpc("closer_limbo_leads" as never)
    .catch(() => ({ data: null })) as { data: Array<Record<string, unknown>> | null };

  // Si la RPC no existe, fallback manual
  if (limboLeads === null) {
    const { data: activeLeads } = await sb
      .from("leads")
      .select("id, name, closer_id, estado_cierre, sesion_plan_at, trial_scheduled_at, trial_attended_at, trial_absent_at")
      .not("closer_id", "is", null)
      .in("estado_cierre", ["activo"])
      .not("status", "in", "(converted,lost,not_qualified)")
      .limit(200);

    if (activeLeads && activeLeads.length > 0) {
      const leadIds = activeLeads.map((l: Record<string, unknown>) => l.id as string);

      const [tareasRes, chainsRes] = await Promise.all([
        sb.from("tareas_closer")
          .select("lead_id")
          .in("lead_id", leadIds)
          .is("fecha_completada", null)
          .gt("fecha_programada", nowIso),
        sb.from("lead_chains")
          .select("lead_id")
          .in("lead_id", leadIds)
          .is("completed_at", null),
      ]);

      const hasPlay = new Set<string>();
      for (const t of (tareasRes.data ?? []) as Array<{ lead_id: string }>) hasPlay.add(t.lead_id);
      for (const c of (chainsRes.data ?? []) as Array<{ lead_id: string }>) hasPlay.add(c.lead_id);

      const stuck = activeLeads.filter((l: Record<string, unknown>) => !hasPlay.has(l.id as string));
      if (stuck.length > 0) {
        out.push({
          code: "LEAD_LIMBO",
          title: "Leads activos sin próxima jugada (anti-limbo no los capturó)",
          count: stuck.length,
          rows: stuck.slice(0, 10) as Record<string, unknown>[],
        });
      }
    }
  }

  // D) Cadenas estancadas — next_fire_at >24h en el pasado
  const { data: stuckChains } = await sb
    .from("lead_chains")
    .select("id, lead_id, chain_type, current_step, next_fire_at")
    .is("completed_at", null)
    .not("next_fire_at", "is", null)
    .lt("next_fire_at", ago24h)
    .limit(20);

  if (stuckChains && stuckChains.length > 0) {
    out.push({
      code: "STUCK_CHAIN",
      title: "Cadenas con next_fire_at >24h atrasado (chain-processor no las procesa)",
      count: stuckChains.length,
      rows: stuckChains as Record<string, unknown>[],
    });
  }

  return out;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const anomalies = await findAnomalies();
  const total = anomalies.reduce((s, a) => s + a.count, 0);

  if (total > 0) {
    const recipient = process.env.ADMIN_EMAIL || process.env.DIGEST_RECIPIENT;
    if (recipient) {
      const body = anomalies
        .map(a => `## ${a.code} — ${a.title} (${a.count})\n${JSON.stringify(a.rows, null, 2)}`)
        .join("\n\n---\n\n");

      await sendRaw({
        to: recipient,
        subject: `[Closer Health] ${total} anomalía(s) detectada(s)`,
        html: `<pre style="font-size:13px;white-space:pre-wrap">${body}</pre>`,
      }).catch((err) => console.error("[closer-health-check] email error:", err));
    }
  }

  return NextResponse.json({
    ok: true,
    anomalies: anomalies.length,
    total,
    details: anomalies.map(a => ({ code: a.code, count: a.count })),
  });
}
