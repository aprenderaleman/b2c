import { NextResponse } from "next/server";

/**
 * GET /api/admin/wa/evo-diag?mode=state|findall|find-msg|delete-session&...
 *
 * Diagnóstico one-shot de Evolution. Auth con CRON_SECRET. Herramienta
 * de ops: para saber qué shape de endpoint responde realmente nuestra
 * instalación Evolution antes de arreglar los crons de delivery.
 *
 * Modes:
 *   - state (default): connectionState de la instancia activa
 *   - findall: findMessages sin filtro (últimos N) — a ver shape
 *   - find-msg&id=XXX: findMessages filtrado por key.id
 *   - delete-session&phone=E164: prueba el endpoint deleteSession
 *   - find-by-chat&phone=E164: findMessages con where.key.remoteJid
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

async function getActiveInstance(): Promise<string> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const sb = supabaseAdmin();
  const { data } = await sb.from("system_config").select("value").eq("key", "wa_setter_instance").maybeSingle();
  return ((data as { value?: string } | null)?.value) ?? process.env.EVOLUTION_INSTANCE_MAIN ?? "aprender-aleman-main";
}

type Probe = { label: string; method: "GET"|"POST"; path: string; body?: unknown };
async function probe(evoUrl: string, evoKey: string, p: Probe) {
  try {
    const res = await fetch(`${evoUrl}${p.path}`, {
      method: p.method,
      headers: {
        apikey: evoKey,
        ...(p.body ? { "Content-Type": "application/json" } : {}),
      },
      body: p.body ? JSON.stringify(p.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch {}
    return { label: p.label, method: p.method, path: p.path, status: res.status, body: json ?? text.slice(0, 2000) };
  } catch (e) {
    return { label: p.label, method: p.method, path: p.path, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "state";
  const inst = url.searchParams.get("instance") ?? await getActiveInstance();
  const id = url.searchParams.get("id");
  const phone = url.searchParams.get("phone");
  const digits = phone ? phone.replace(/\D/g, "") : null;
  const jid = digits ? `${digits}@s.whatsapp.net` : null;

  const probes: Probe[] = [];
  if (mode === "state" || mode === "all") {
    probes.push({ label: "connectionState", method: "GET", path: `/instance/connectionState/${encodeURIComponent(inst)}` });
    probes.push({ label: "fetchInstances", method: "GET", path: `/instance/fetchInstances?instanceName=${encodeURIComponent(inst)}` });
  }
  if (mode === "findall" || mode === "all") {
    probes.push({ label: "findMessages_empty_body",     method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: {} });
    probes.push({ label: "findMessages_with_where",     method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: { where: {}, limit: 5 } });
    probes.push({ label: "message_findMessages",        method: "POST", path: `/message/findMessages/${encodeURIComponent(inst)}`, body: {} });
  }
  if (mode === "find-msg" && id) {
    probes.push({ label: "find_msg_shapeA", method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: { where: { key: { id } } } });
    probes.push({ label: "find_msg_shapeB", method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: { where: { keyId: id } } });
    probes.push({ label: "find_msg_shapeC", method: "POST", path: `/message/findMessages/${encodeURIComponent(inst)}`, body: { where: { key: { id } } } });
  }
  if (mode === "find-by-chat" && jid) {
    probes.push({ label: "find_by_chat_shapeA", method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: { where: { key: { remoteJid: jid } }, limit: 10 } });
    probes.push({ label: "find_by_chat_shapeB", method: "POST", path: `/chat/findMessages/${encodeURIComponent(inst)}`, body: { where: { remoteJid: jid }, limit: 10 } });
  }
  if (mode === "delete-session" && digits) {
    probes.push({ label: "ds_shapeA_body_number", method: "POST", path: `/chat/deleteSession/${encodeURIComponent(inst)}`, body: { number: digits } });
    probes.push({ label: "ds_shapeB_body_jid",    method: "POST", path: `/chat/deleteSession/${encodeURIComponent(inst)}`, body: { jid } });
    probes.push({ label: "ds_shapeC_delete",      method: "DELETE" as never, path: `/chat/deleteSession/${encodeURIComponent(inst)}`, body: { number: digits } });
    probes.push({ label: "ds_shapeD_message_ds",  method: "POST", path: `/message/deleteSession/${encodeURIComponent(inst)}`, body: { number: digits } });
  }

  const results = [];
  for (const p of probes) results.push(await probe(evoUrl, evoKey, p));

  return NextResponse.json({ ok: true, instance: inst, mode, results });
}
