import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/messaging-audit-daily
 *
 * Auditoría diaria del *comportamiento* del sistema de mensajería
 * (Gelfis 2026-08-19). Complementa `messaging-health-daily` (infra):
 * aquí revisamos datos y comportamiento observable de las últimas 24h.
 *
 * Chequeos:
 *   1. Motor        — kill switch, cap diario Berlin, instancia activa
 *   2. Chains       — next_fire vencido >20min sin completar
 *   3. Anti-spam    — leads con ≥5 msgs/24h (señal de bombardeo)
 *   4. Templates    — placeholders desconocidos o braces desbalanceados
 *   5. Envíos       — placeholders crudos que llegaron al lead (24h)
 *   6. Rescate      — sesion_absent >30min sin primer envío
 *
 * Al final crea UNA notificación in-app (dedupeHours=20 → no duplica si
 * la anterior sigue sin leer). Severity:
 *   - "info"    → 0 problemas
 *   - "warning" → solo warnings
 *   - "critical" → al menos 1 crítico
 */

type Status = "info" | "warning" | "critical";
type Check = { name: string; status: Status; detail: string };

const KNOWN_PLACEHOLDERS = new Set([
  "nombre","profe","meta","ritmo_recomendado","ritmo","precio_ritmo","fecha_llegada",
  "dia_bonus","link_inscripciones","link_pago","link_reagenda","link_agenda","link_sesion",
  "link","closer","link_hans","link_schule","nueva_fecha","hora",
]);

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

/** Instante UTC que corresponde a "hoy 00:00 Berlin". */
function getStartOfDayBerlinUtc(now: Date): string {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const hourFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(dayFmt.formatToParts(now).map(p => [p.type, p.value]));
  const [y, m, d] = [Number(parts.year), Number(parts.month), Number(parts.day)];
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(hourFmt.formatToParts(guess).map(x => [x.type, x.value]));
    const diffMs = ((0 - Number(p.hour)) * 60 - Number(p.minute)) * 60_000;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess.toISOString();
}

async function runAudit(): Promise<Check[]> {
  const sb = supabaseAdmin();
  const checks: Check[] = [];
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();

  // ── 1. Salud motor ──────────────────────────────────────────────
  const { data: cfgRows } = await sb.from("system_config").select("key, value")
    .in("key", ["whatsapp_disabled", "wa_daily_send_cap", "active_whatsapp_instance",
                "evolution_health_fail_count"]);
  const cfg: Record<string, string> = {};
  for (const r of (cfgRows ?? [])) cfg[r.key] = r.value;

  if ((cfg.whatsapp_disabled ?? "off") !== "off") {
    checks.push({ name: "kill_switch", status: "critical",
      detail: `kill switch = "${cfg.whatsapp_disabled}" (esperado "off")` });
  }
  if (!cfg.active_whatsapp_instance) {
    checks.push({ name: "instancia_wa", status: "critical",
      detail: "system_config.active_whatsapp_instance vacío — envíos van a fallar" });
  }

  // Cap diario Berlin
  const berlinTodayISO = getStartOfDayBerlinUtc(now);
  const { count: sentToday } = await sb.from("lead_timeline")
    .select("*", { count: "exact", head: true })
    .eq("type", "system_message_sent")
    .gte("timestamp", berlinTodayISO);
  const cap = Number(cfg.wa_daily_send_cap ?? "300");
  const sent = sentToday ?? 0;
  if (sent > cap * 0.8) {
    checks.push({ name: "cap_diario",
      status: sent > cap * 0.95 ? "critical" : "warning",
      detail: `enviados hoy Berlin: ${sent}/${cap} (${Math.round(sent*100/cap)}%)` });
  }

  // ── 2. Chains atascadas ─────────────────────────────────────────
  const stuckCutoff = new Date(now.getTime() - 20 * 60_000).toISOString();
  const { data: stuck } = await sb.from("lead_chains")
    .select("chain_type, next_fire_at, lead_id, leads(name)")
    .is("completed_at", null)
    .lt("next_fire_at", stuckCutoff)
    .order("next_fire_at", { ascending: true })
    .limit(20);
  if (stuck && stuck.length > 0) {
    const sample = stuck.slice(0, 5).map(r => {
      const leads = (r as unknown as { leads: { name: string } | null }).leads;
      const name = leads?.name ?? "?";
      const delayMin = Math.round((now.getTime() - new Date(r.next_fire_at).getTime()) / 60_000);
      return `${name} (${r.chain_type}, ${delayMin}min)`;
    }).join(" · ");
    checks.push({ name: "chains_atascadas",
      status: stuck.length >= 5 ? "critical" : "warning",
      detail: `${stuck.length} chains con next_fire vencido >20min. Top: ${sample}` });
  }

  // ── 3. Anti-spam ────────────────────────────────────────────────
  const { data: msgs24h } = await sb.from("lead_timeline")
    .select("lead_id")
    .eq("type", "system_message_sent")
    .gte("timestamp", dayAgo);
  const perLead: Record<string, number> = {};
  for (const m of (msgs24h ?? [])) {
    perLead[m.lead_id] = (perLead[m.lead_id] ?? 0) + 1;
  }
  const bombed = Object.entries(perLead).filter(([, n]) => n >= 5);
  if (bombed.length > 0) {
    checks.push({ name: "bombardeo", status: "critical",
      detail: `${bombed.length} lead(s) recibieron ≥5 msgs en 24h: ${bombed.slice(0,3).map(([id, n]) => `${id.slice(0,8)}(${n})`).join(", ")}` });
  }

  // ── 4. Templates ────────────────────────────────────────────────
  const { data: templates } = await sb.from("message_templates").select("kind, sub_n, body");
  const badTemplates: string[] = [];
  for (const t of (templates ?? [])) {
    const body = t.body as string;
    const placeholders = new Set([...body.matchAll(/\{([a-z_][a-z_0-9]*)\}/g)].map(m => m[1]));
    const unknown = [...placeholders].filter(p => !KNOWN_PLACEHOLDERS.has(p));
    const braceMismatch = body.split("{").length !== body.split("}").length;
    if (unknown.length > 0) badTemplates.push(`${t.kind}#${t.sub_n} usa {${unknown.join(",")}}`);
    if (braceMismatch)      badTemplates.push(`${t.kind}#${t.sub_n} braces desbalanceados`);
  }
  if (badTemplates.length > 0) {
    checks.push({ name: "templates_rotos", status: "critical",
      detail: badTemplates.join(" | ") });
  }

  // ── 5. Envíos con placeholders crudos ──────────────────────────
  const { data: recentSends } = await sb.from("lead_timeline")
    .select("content, lead_id, timestamp")
    .eq("type", "system_message_sent")
    .gte("timestamp", dayAgo)
    .limit(500);
  const raw = (recentSends ?? []).filter(r => /\{[a-z_]+\}/.test((r.content ?? "") as string));
  if (raw.length > 0) {
    checks.push({ name: "placeholders_crudos", status: "critical",
      detail: `${raw.length} mensajes enviados con {placeholder} sin resolver en 24h` });
  }
  const tinyMsgs = (recentSends ?? []).filter(r => {
    const c = ((r.content ?? "") as string).trim();
    return c.length > 0 && c.length < 20 && !c.startsWith("📋") && !c.startsWith("💬");
  });
  if (tinyMsgs.length > 0) {
    checks.push({ name: "mensajes_vacios", status: "warning",
      detail: `${tinyMsgs.length} mensajes <20 chars en 24h — posibles renders vacíos` });
  }

  // ── 6. Rescate no-show lento ────────────────────────────────────
  const { data: rescueChains } = await sb.from("lead_chains")
    .select("started_at, last_auto_sent_at, lead_id, leads(name)")
    .eq("chain_type", "sesion_absent")
    .gte("started_at", dayAgo);
  const slowRescue = (rescueChains ?? []).filter(r => {
    if (r.last_auto_sent_at) return false;
    return (now.getTime() - new Date(r.started_at).getTime()) > 30 * 60_000;
  });
  if (slowRescue.length > 0) {
    const sample = slowRescue.slice(0, 3).map(r => {
      const leads = (r as unknown as { leads: { name: string } | null }).leads;
      return leads?.name ?? "?";
    }).join(", ");
    checks.push({ name: "rescate_lento", status: "warning",
      detail: `${slowRescue.length} sesion_absent >30min sin primer envío. Ej: ${sample}` });
  }

  return checks;
}

function overallStatus(checks: Check[]): Status {
  if (checks.some(c => c.status === "critical")) return "critical";
  if (checks.some(c => c.status === "warning"))  return "warning";
  return "info";
}

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checks = await runAudit();
  const overall = overallStatus(checks);
  const crit = checks.filter(c => c.status === "critical").length;
  const warn = checks.filter(c => c.status === "warning").length;

  const title = overall === "critical"
    ? `🔴 Auditoría mensajería — ${crit} crítico(s)${warn ? ` · ${warn} warning(s)` : ""}`
    : overall === "warning"
    ? `⚠️ Auditoría mensajería — ${warn} warning(s)`
    : "✅ Auditoría mensajería — todo OK";

  const bodyLines: string[] = [];
  if (checks.length === 0) {
    bodyLines.push("Sistema de mensajería sin problemas detectados.");
    bodyLines.push("Chequeos superados: kill=off · cap OK · sin chains atascadas · sin bombardeo · templates sanos · rescates a tiempo.");
  } else {
    const emoji = { critical: "🔴", warning: "⚠️", info: "•" };
    for (const c of checks) {
      bodyLines.push(`${emoji[c.status]} ${c.name}`);
      bodyLines.push(`   ${c.detail}`);
    }
  }

  await createAdminNotification({
    type: "messaging_audit_daily",
    severity: overall,
    title,
    body: bodyLines.join("\n"),
    metadata: { checks, crit_count: crit, warn_count: warn },
    dedupeHours: 20,
  });

  return NextResponse.json({ ok: true, overall, count: checks.length, checks });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
