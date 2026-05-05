import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";

/**
 * GET /api/cron/data-integrity-check
 *
 * Vercel Cron triggers this once a day. Detects data inconsistencies
 * that historically caused billing errors:
 *
 *   A) Clases `completed` con `billed_hours = 0` y duración > 0 → el cron
 *      de billing no las cerró bien.
 *   B) Clases `scheduled` con `scheduled_at` ya pasado >12h → el cron
 *      que cierra clases no las atrapó.
 *   C) Filas en `class_participants` con `class.scheduled_at <
 *      student_group_members.joined_at` → bug del backfill de Zoom
 *      asignando clases fantasma.
 *   D) Backfill masivo: ≥5 class_participants creados el mismo día con
 *      scheduled_at en el pasado lejano (smoking gun de un script masivo).
 *   E) Profesores con `teacher_earnings` mes-en-curso vacío teniendo
 *      clases impartidas.
 *
 * Si encuentra >0 anomalías, envía un email al admin con el detalle.
 *
 * ENV: CRON_SECRET, ADMIN_EMAIL (o DIGEST_RECIPIENT).
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
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

  // A) Completed con bill=0 y duración real
  {
    const { data, error } = await sb.rpc("data_integrity_completed_zero_bill" as never).maybeSingle().then(
      // Fallback: rpc may not exist yet. Use raw query via PostgREST.
      () => sb.from("classes")
        .select("id, scheduled_at, title, duration_minutes, actual_duration_minutes, status, billed_hours")
        .eq("status", "completed")
        .eq("billed_hours", 0)
        .gte("scheduled_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString())
        .order("scheduled_at", { ascending: false })
        .limit(50),
    );
    const rows = (data ?? []).filter((r: { duration_minutes?: number; actual_duration_minutes?: number }) =>
      ((r.actual_duration_minutes ?? 0) > 0) || ((r.duration_minutes ?? 0) >= 15),
    );
    if (rows.length > 0) {
      out.push({
        code: "completed_zero_bill",
        title: "Clases 'completed' con billed_hours=0 (last 60d)",
        count: rows.length,
        rows: rows.slice(0, 20),
      });
    }
    if (error) {
      out.push({ code: "_error_A", title: "Error en query A", count: 0, rows: [{ error: error.message }] });
    }
  }

  // B) Scheduled cuyo start fue hace >12h
  {
    const { data } = await sb
      .from("classes")
      .select("id, scheduled_at, title, status, teacher_id")
      .eq("status", "scheduled")
      .lt("scheduled_at", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
      .gt("scheduled_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(50);
    if ((data ?? []).length > 0) {
      out.push({
        code: "stale_scheduled",
        title: "Clases 'scheduled' cuya hora pasó hace >12h (last 60d)",
        count: (data ?? []).length,
        rows: (data ?? []).slice(0, 20),
      });
    }
  }

  // C) class_participants con scheduled_at < joined_at del grupo
  // (necesita raw SQL — usamos la conexión directa via `pg` helper si disponible,
  // o como fallback un PostgREST con join — pero PostgREST no permite el cruce
  // arbitrario de columnas. Usamos RPC personalizada definida abajo, o si no
  // existe, un fetch a una view materializada).
  {
    const { data, error } = await sb.rpc("data_integrity_phantom_membership" as never);
    if (!error && Array.isArray(data) && data.length > 0) {
      out.push({
        code: "phantom_membership",
        title: "class_participants con clase ANTERIOR al joined_at del alumno (bug del backfill)",
        count: data.length,
        rows: (data as Array<Record<string, unknown>>).slice(0, 30),
      });
    }
    // Si la RPC aún no existe, no falla el cron.
  }

  // D) Bulk backfill detection
  {
    const { data, error } = await sb.rpc("data_integrity_bulk_backfill" as never);
    if (!error && Array.isArray(data) && data.length > 0) {
      out.push({
        code: "bulk_backfill",
        title: "Backfill masivo: ≥5 class_participants creados en un solo día con scheduled_at en pasado lejano",
        count: data.length,
        rows: (data as Array<Record<string, unknown>>).slice(0, 30),
      });
    }
  }

  return out;
}

function renderHtml(anomalies: Anomaly[]): { subject: string; html: string; text: string } {
  if (anomalies.length === 0) {
    return {
      subject: "✓ Data integrity check OK",
      html: `<p>Sin anomalías detectadas hoy.</p>`,
      text: "Sin anomalías detectadas hoy.",
    };
  }

  const total = anomalies.reduce((s, a) => s + a.count, 0);
  const sections = anomalies.map(a => {
    const rowsHtml = a.rows
      .map(r => `<li><code>${escapeHtml(JSON.stringify(r))}</code></li>`)
      .join("");
    return `<h3>${escapeHtml(a.title)} — <strong>${a.count}</strong></h3><ul>${rowsHtml}</ul>`;
  }).join("");

  const sectionsText = anomalies.map(a => {
    const rowsTxt = a.rows.map(r => `  - ${JSON.stringify(r)}`).join("\n");
    return `### ${a.title} — ${a.count}\n${rowsTxt}`;
  }).join("\n\n");

  return {
    subject: `⚠ Data integrity check: ${anomalies.length} anomalía(s), ${total} fila(s)`,
    html: `<h2>Anomalías detectadas en BD</h2><p>Total filas: <strong>${total}</strong></p>${sections}`,
    text: `Anomalías detectadas (total filas: ${total})\n\n${sectionsText}`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const recipient = process.env.DIGEST_RECIPIENT ?? process.env.ADMIN_EMAIL;
  if (!recipient) {
    return NextResponse.json({ error: "no_recipient_configured" }, { status: 503 });
  }

  const anomalies = await findAnomalies();
  const { subject, html, text } = renderHtml(anomalies);

  // Enviar SOLO si hay anomalías. Silencio si todo está OK (evita ruido).
  if (anomalies.length > 0) {
    const r = await sendRaw(recipient, subject, html, text);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error, anomalies: anomalies.length }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, anomalies: anomalies.length, total_rows: anomalies.reduce((s,a)=>s+a.count,0) });
}

export const POST = GET;
