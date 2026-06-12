import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getMessageStats, listTemplates } from "@/lib/message-stats";
import { KIND_CATALOG, getCatalogEntry } from "@/lib/message-catalog";
import { MessageRow } from "./MessageRow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensajes · efectividad · Admin" };

const RANGES: Array<{ label: string; days: number }> = [
  { label: "Hoy",      days: 1   },
  { label: "7 días",   days: 7   },
  { label: "30 días",  days: 30  },
  { label: "90 días",  days: 90  },
];

const CHANNEL_FILTERS: Array<{ label: string; value: string }> = [
  { label: "Todos", value: "" },
  { label: "WhatsApp",  value: "whatsapp" },
  { label: "WA",        value: "wa" },
  { label: "Email",     value: "email" },
  { label: "WA+Email",  value: "wa+email" },
];

export default async function MensajesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; channel?: string; q?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;

  const daysRaw = Number(sp.days ?? 30);
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365 ? Math.round(daysRaw) : 30;
  const channel = (sp.channel ?? "").trim();
  const q       = (sp.q ?? "").trim().toLowerCase();

  const [stats, templates] = await Promise.all([
    getMessageStats({ days, channel: channel || undefined }),
    listTemplates(),
  ]);

  // Index templates por (kind, channel) para pasarlos al componente row.
  const templatesByKey = new Map<string, ReturnType<typeof templates[0] extends never ? never : (a: typeof templates[0]) => typeof templates[0]>>();
  for (const t of templates) {
    templatesByKey.set(`${t.kind}::${t.channel}`, t as unknown as never);
  }

  // Búsqueda de texto: por kind, name o sample preview.
  const visible = q
    ? stats.filter(s => {
        const cat = getCatalogEntry(s.kind);
        return s.kind.toLowerCase().includes(q)
          || (cat?.name ?? "").toLowerCase().includes(q)
          || s.samples.some(x => x.preview.toLowerCase().includes(q));
      })
    : stats;

  const totalSent      = visible.reduce((a, s) => a + s.sent, 0);
  const totalResponded = visible.reduce((a, s) => a + s.responded7d, 0);
  const globalRate     = totalSent > 0 ? (100 * totalResponded / totalSent) : 0;

  // Kinds del catálogo que no aparecieron en los stats (sin envíos).
  const seenKindChannels = new Set(stats.map(s => `${s.kind}::${s.channel}`));
  const orphanCatalog = KIND_CATALOG.filter(c => !Array.from(seenKindChannels).some(k => k.startsWith(c.kind + "::")));

  return (
    <div className="px-5 md:px-8 py-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">💬 Mensajes — efectividad</h1>
          <p className="mt-1 text-sm text-white/60">
            ¿Cuáles mensajes provocan respuesta? Respondido = el lead escribió de vuelta en los siguientes 7 días.
          </p>
        </div>
      </div>

      {/* ── Filtros ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col md:flex-row gap-3 md:items-end">
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Rango</div>
          <div className="flex gap-1 flex-wrap">
            {RANGES.map(r => (
              <Link
                key={r.days}
                href={`/admin/mensajes?days=${r.days}${channel ? `&channel=${channel}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`px-3 py-1.5 rounded-md text-sm transition ${
                  r.days === days
                    ? "bg-warm text-warm-foreground font-semibold"
                    : "border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Canal</div>
          <div className="flex gap-1 flex-wrap">
            {CHANNEL_FILTERS.map(c => (
              <Link
                key={c.value || "all"}
                href={`/admin/mensajes?days=${days}${c.value ? `&channel=${c.value}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`px-3 py-1.5 rounded-md text-sm transition ${
                  channel === c.value
                    ? "bg-warm text-warm-foreground font-semibold"
                    : "border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
        <form action="/admin/mensajes" method="get" className="md:w-72">
          <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1.5">Buscar texto</div>
          <input type="hidden" name="days" value={days} />
          {channel && <input type="hidden" name="channel" value={channel} />}
          <div className="flex gap-1.5">
            <input
              name="q" type="text" defaultValue={q}
              placeholder="Ej: clase de prueba, agendar"
              className="flex-1 h-9 px-2 rounded-md border border-white/10 bg-white/5 text-sm text-white"
            />
            <button type="submit" className="px-3 py-1.5 rounded-md text-sm bg-warm text-warm-foreground font-semibold hover:opacity-90">Buscar</button>
          </div>
        </form>
      </section>

      {/* ── KPIs globales ─────────────────────────────────────── */}
      <section className="mt-5 grid grid-cols-3 gap-3">
        <KpiCard label="Mensajes enviados" value={totalSent.toLocaleString()} accent="text-white" />
        <KpiCard label="Respondidos en 7d" value={totalResponded.toLocaleString()} accent="text-white" />
        <KpiCard
          label="Tasa de respuesta global"
          value={`${globalRate.toFixed(1)}%`}
          accent={globalRate >= 20 ? "text-emerald-300" : globalRate >= 10 ? "text-amber-300" : "text-red-300"}
        />
      </section>

      {/* ── Tabla principal ───────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-white">Plantillas activas (con envíos en el rango)</h2>
        <p className="mt-1 text-xs text-white/55">
          Ordenadas por volumen. ⚠️ Las marcadas como &quot;código&quot; aún no son editables desde aquí — modifícalas en el archivo indicado.
        </p>
        <div className="mt-3 space-y-2">
          {visible.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/60">
              No hay mensajes en el rango{channel ? ` con canal ${channel}` : ""}.
              {q && ` Filtro de texto: "${q}".`}
            </div>
          )}
          {visible.map(s => {
            const cat = getCatalogEntry(s.kind);
            const tpl = templatesByKey.get(`${s.kind}::${s.channel}`) ?? null;
            return (
              <MessageRow
                key={`${s.kind}::${s.channel}`}
                stats={s}
                catalog={cat}
                template={tpl as unknown as Parameters<typeof MessageRow>[0]["template"]}
              />
            );
          })}
        </div>
      </section>

      {/* ── Catálogo sin actividad ───────────────────────────── */}
      {orphanCatalog.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-white/80">Catálogo sin envíos en el rango</h2>
          <p className="mt-1 text-xs text-white/45">
            Plantillas definidas en el catálogo que NO se enviaron en los últimos {days} días.
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            {orphanCatalog.map(c => (
              <span key={c.kind} className="text-xs rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/60">
                {c.name}
                <span className="ml-1.5 text-white/35 font-mono">{c.kind}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wider text-white/50">{label}</div>
      <div className={`mt-1 text-2xl md:text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
