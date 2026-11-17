import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/wa/pending-manual?secret=X&format=json|html
 *
 * Lista los WA bloqueados por cap/night_gate hoy, con texto + waLink
 * listo para copiar y enviar desde WhatsApp Business.
 *
 * Gelfis 2026-11-17: cuando se agota el cap setter V6 (día 1 warm-up),
 * el sistema marca cada envío fallido con un agent_note "wa_manual_pending"
 * con todo lo necesario. Este endpoint los recolecta.
 *
 * Auth: secret o X-Cron-Secret.
 * format=html → página con botones "Copiar" y "Abrir WhatsApp".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.CRON_SECRET;
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const format = url.searchParams.get("format") ?? "json";

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("lead_timeline")
    .select("id, timestamp, lead_id, metadata")
    .eq("metadata->>kind", "wa_manual_pending")
    .is("metadata->sent_manual_at", null)
    .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("timestamp", { ascending: false });

  const rows = (data ?? []) as Array<{
    id: string; timestamp: string; lead_id: string;
    metadata: {
      original_kind?: string; phone?: string; text?: string;
      wa_link?: string; reason?: string;
    };
  }>;

  // Enrich with lead name
  const leadIds = Array.from(new Set(rows.map(r => r.lead_id)));
  const leads = leadIds.length ? (await sb
    .from("leads").select("id, name").in("id", leadIds)).data ?? [] : [];
  const leadMap = Object.fromEntries((leads as Array<{ id: string; name: string }>).map(l => [l.id, l.name]));

  const enriched = rows.map(r => ({
    id: r.id,
    ts: r.timestamp,
    lead_id: r.lead_id,
    lead_name: leadMap[r.lead_id] ?? "(sin nombre)",
    kind: r.metadata.original_kind,
    phone: r.metadata.phone,
    reason: r.metadata.reason,
    text: r.metadata.text,
    wa_link: r.metadata.wa_link,
  }));

  if (format === "html") {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WA Pendientes Manual</title>
<style>
body{font:14px -apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;max-width:920px;margin:0 auto}
h1{font-size:18px;margin:0 0 4px}.sub{color:#94a3b8;margin-bottom:16px}
.card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px;margin:12px 0}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.name{font-weight:600}.phone{color:#94a3b8;font-family:monospace;font-size:13px}
.badge{background:#ef4444;color:white;font-size:11px;padding:2px 8px;border-radius:10px;text-transform:uppercase}
pre{background:rgba(226,232,240,.05);padding:10px;border-radius:6px;font-size:13px;white-space:pre-wrap;margin:0 0 10px;max-height:200px;overflow-y:auto}
.btns{display:flex;gap:6px;flex-wrap:wrap}
button{background:#22c55e;color:white;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500}
button:hover{background:#16a34a}.wa{background:#25d366}
</style></head><body>
<h1>📱 WA pendientes de envío manual</h1>
<div class="sub">${enriched.length} mensajes bloqueados por cap/night_gate últimas 24h</div>
${enriched.map((r,i)=>`
<div class="card" id="card-${r.id}">
  <div class="head">
    <span style="color:#94a3b8">#${i+1}.</span>
    <span class="name">${r.lead_name}</span>
    <span class="phone">${r.phone}</span>
    <span class="badge">${r.reason}</span>
    <span style="margin-left:auto;color:#94a3b8;font-size:12px">${new Date(r.ts).toLocaleString("es-ES",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"})}</span>
  </div>
  <div style="color:#94a3b8;font-size:12px;margin-bottom:8px">kind: ${r.kind}</div>
  <pre id="t${i}">${(r.text||"").replace(/[<>&]/g,m=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[m]||m))}</pre>
  <div class="btns">
    <button onclick="navigator.clipboard.writeText(document.getElementById('t${i}').innerText);this.innerText='✓ Copiado';setTimeout(()=>this.innerText='📋 Copiar',1200)">📋 Copiar</button>
    <button class="wa" onclick="window.open('${r.wa_link}','_blank')">💬 Abrir WhatsApp</button>
    <button style="background:#64748b" onclick="markSent('${r.id}','${r.lead_id}','${r.kind}')">✓ Marcar enviado</button>
  </div>
</div>`).join("")}
<script>
const SECRET = ${JSON.stringify(provided ?? "")};
async function markSent(id, leadId, kind) {
  const r = await fetch('/api/admin/wa/pending-manual/mark-sent?secret='+encodeURIComponent(SECRET), {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ timeline_id: id, lead_id: leadId, kind }),
  });
  if (r.ok) { document.getElementById('card-'+id).style.display='none'; }
  else { alert('Error marcando como enviado'); }
}
</script>
</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return NextResponse.json({ count: enriched.length, pending: enriched });
}
