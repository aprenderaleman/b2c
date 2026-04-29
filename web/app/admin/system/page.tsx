"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Admin system-health dashboard. Polls /api/admin/system/health every
 * 20 s so the admin sees in real time whether the messaging pipeline
 * is alive — Evolution session state, last inbound / outbound, stuck
 * leads, recent send_failed.
 *
 * One screen, one job: tell the admin "is the bot working right now?"
 * Quick-action buttons for common recovery moves are linked from
 * here too.
 */

type Health = {
  ok: boolean;
  now: string;
  evolution: { state: "open" | "connecting" | "close" | "unknown"; via: string; error?: string };
  inbound:   { lastAt: string | null; ageSec: number | null; concern: boolean };
  outbound:  { lastAt: string | null; ageSec: number | null; concern: boolean };
  failed24h: number;
  stuckLeads: number;
  overall: "ok" | "warn";
};

function fmtAge(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} d`;
}

const STATE_DOT: Record<Health["evolution"]["state"], string> = {
  open:       "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  close:      "bg-red-500",
  unknown:    "bg-slate-500",
};

export default function SystemPage() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/admin/system/health", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled) {
          if (r.ok) { setH(d); setErr(null); }
          else      { setErr(d.error ?? `http_${r.status}`); }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "unknown");
      }
    };
    tick();
    const t = setInterval(tick, 20_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Estado del sistema</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Salud del pipeline de mensajería. Refresca cada 20 s.
          </p>
        </div>
        {h && (
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              h.overall === "ok"
                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30"
                : "bg-amber-50  dark:bg-amber-500/10  text-amber-700  dark:text-amber-300  ring-1 ring-amber-200  dark:ring-amber-500/30"
            }`}
          >
            {h.overall === "ok" ? "✓ Todo OK" : "⚠ Atención"}
          </span>
        )}
      </header>

      {err && (
        <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          Error consultando: {err}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {/* Evolution */}
        <Card title="WhatsApp / Evolution">
          {h ? (
            <>
              <Row label="Sesión">
                <span className="inline-flex items-center gap-2 font-mono text-sm">
                  <span className={`h-2 w-2 rounded-full ${STATE_DOT[h.evolution.state]}`} />
                  {h.evolution.state}
                </span>
              </Row>
              <Row label="Vía"><span className="text-xs text-slate-500">{h.evolution.via}</span></Row>
              {h.evolution.error && (
                <Row label="Error"><span className="text-xs text-red-500">{h.evolution.error}</span></Row>
              )}
            </>
          ) : <Skel />}
        </Card>

        {/* Inbound */}
        <Card title="Mensajes entrantes" highlight={h?.inbound.concern}>
          {h ? (
            <>
              <Row label="Último"><span className="font-mono text-sm">{fmtAge(h.inbound.ageSec)}</span></Row>
              <Row label="Cuándo">
                <span className="text-xs text-slate-500">
                  {h.inbound.lastAt ? new Date(h.inbound.lastAt).toLocaleString("es-ES", { timeZone: "Europe/Berlin" }) : "—"}
                </span>
              </Row>
              {h.inbound.concern && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                  ⚠ Más de 6h sin recibir nada. Probable webhook desconfigurado.
                </p>
              )}
            </>
          ) : <Skel />}
        </Card>

        {/* Outbound */}
        <Card title="Mensajes salientes" highlight={h?.outbound.concern}>
          {h ? (
            <>
              <Row label="Último"><span className="font-mono text-sm">{fmtAge(h.outbound.ageSec)}</span></Row>
              <Row label="Cuándo">
                <span className="text-xs text-slate-500">
                  {h.outbound.lastAt ? new Date(h.outbound.lastAt).toLocaleString("es-ES", { timeZone: "Europe/Berlin" }) : "—"}
                </span>
              </Row>
            </>
          ) : <Skel />}
        </Card>

        {/* Counters */}
        <Card title="Errores y atascos">
          {h ? (
            <>
              <Row label="Fallos en 24h">
                <span className={`font-bold text-lg ${h.failed24h > 0 ? "text-red-500" : "text-emerald-500"}`}>
                  {h.failed24h}
                </span>
              </Row>
              <Row label="Leads atascados">
                <span className={`font-bold text-lg ${h.stuckLeads > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                  {h.stuckLeads}
                </span>
              </Row>
              <Link href="/admin/leads" className="block mt-2 text-xs text-brand-600 hover:underline">Ver lista de leads →</Link>
            </>
          ) : <Skel />}
        </Card>
      </div>

      {/* Recovery actions */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Acciones de recuperación
        </h2>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Si Evolution está caído, los siguientes pasos te permiten desatascarte sin esperar al reinicio:
        </p>
        <ol className="mt-3 list-decimal pl-5 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            En cada lead afectado, abre <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">/admin/leads/[id]</code> y
            usa <strong>“Acciones rápidas — abrir WhatsApp con plantilla”</strong>. Envías desde tu cuenta personal mientras el bot está caído.
          </li>
          <li>
            En la VPS: <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">docker logs aa_evolution --tail 50</code> para ver
            si la sesión necesita re-escanear el QR (acceso a <code className="px-1">/qr</code> → tu móvil).
          </li>
          <li>
            Si vuelves a recibir mensajes en <strong>Mensajes entrantes</strong>, todo está sano de nuevo.
          </li>
        </ol>
      </section>
    </main>
  );
}

function Card({ title, children, highlight }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section className={`rounded-3xl border p-5 ${
      highlight
        ? "border-amber-300 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-500/5"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    }`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</h2>
      <div className="mt-3 space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
      <div className="h-4 w-1/2 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
    </div>
  );
}
