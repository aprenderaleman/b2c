/**
 * /admin/semaforo — tablero agregado del semáforo global (fase 3,
 * spec Gelfis 2026-08-16, sección 4 ADMIN).
 *
 * Sin gráficas elaboradas: números y listas.
 *   - Contadores ahora: 🔴 N · 🟡 N · 🟢 N
 *   - Tiempo promedio en rojo (7d) — LA métrica de salud
 *   - Rojos por persona asignada
 *   - Lista de rojos actuales con causa y antigüedad → click al lead
 */
import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getActiveSemaforos, avgTimeInRed } from "@/lib/semaforo-observer";
import { CAUSA_RANK, type CausaTipo } from "@/lib/semaforo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Semáforo · Admin" };

function fmtDur(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  if (min < 48 * 60) return `hace ${Math.floor(min / 60)}h`;
  return `hace ${Math.floor(min / 1440)}d`;
}

export default async function SemaforoDashboard() {
  await requireRole(["superadmin", "admin"]);
  const sb = supabaseAdmin();

  const [semaforos, red7] = await Promise.all([
    getActiveSemaforos(),
    avgTimeInRed(7),
  ]);

  const all = [...semaforos.values()];
  const rojos = all.filter(s => s.color === "rojo");
  const amarillos = all.filter(s => s.color === "amarillo").length;
  const verdes = all.filter(s => s.color === "verde").length;
  const limbos = all.filter(s => s.limbo).length;

  // Datos del lead para la lista de rojos (nombre + closer asignado).
  const rojoIds = rojos.map(r => r.leadId);
  const leadInfo = new Map<string, { name: string | null; closer_id: string | null }>();
  const closerName = new Map<string, string>();
  if (rojoIds.length > 0) {
    const { data: leadsData } = await sb
      .from("leads").select("id, name, closer_id").in("id", rojoIds.slice(0, 500));
    for (const l of (leadsData ?? []) as Array<{ id: string; name: string | null; closer_id: string | null }>) {
      leadInfo.set(l.id, { name: l.name, closer_id: l.closer_id });
    }
    const closerIds = [...new Set([...leadInfo.values()].map(l => l.closer_id).filter((x): x is string => !!x))];
    if (closerIds.length > 0) {
      const { data: users } = await sb
        .from("users").select("id, full_name, email").in("id", closerIds);
      for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
        closerName.set(u.id, (u.full_name ?? u.email).split(/\s+/)[0]);
      }
    }
  }

  // Rojos por persona asignada
  const porPersona = new Map<string, number>();
  for (const r of rojos) {
    const cid = leadInfo.get(r.leadId)?.closer_id;
    const who = cid ? (closerName.get(cid) ?? "Closer") : "(sin asignar)";
    porPersona.set(who, (porPersona.get(who) ?? 0) + 1);
  }

  // Orden de la lista de rojos: causa → antigüedad
  const rojosOrdenados = [...rojos].sort((a, b) => {
    const ra = a.causa ? CAUSA_RANK[a.causa as CausaTipo] : 99;
    const rb = b.causa ? CAUSA_RANK[b.causa as CausaTipo] : 99;
    if (ra !== rb) return ra - rb;
    return (a.triggerAt ?? "").localeCompare(b.triggerAt ?? "");
  });

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl md:text-3xl font-bold text-white">🚦 Semáforo</h1>
        <p className="mt-1 text-xs md:text-sm text-white/60">
          Deuda con los leads, calculada de los registros — ventana hábil 08:00–22:00 Berlín.
          El color nunca se edita a mano; cada rojo se explica con sus registros.
        </p>
      </div>

      {/* Contadores ahora */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="text-[10.5px] uppercase tracking-wider text-red-200/70">🔴 Rojos ahora</div>
          <div className="mt-1 text-3xl font-extrabold text-red-300 tabular-nums">{rojos.length}</div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="text-[10.5px] uppercase tracking-wider text-amber-200/70">🟡 Amarillos</div>
          <div className="mt-1 text-3xl font-extrabold text-amber-300 tabular-nums">{amarillos}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="text-[10.5px] uppercase tracking-wider text-emerald-200/70">🟢 Verdes</div>
          <div className="mt-1 text-3xl font-extrabold text-emerald-300 tabular-nums">{verdes - limbos}</div>
          {limbos > 0 && (
            <div className="text-[10.5px] text-white/45">+ {limbos} ⚠️ sin jugada</div>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-[10.5px] uppercase tracking-wider text-white/45">⏱ Prom. en rojo (7d)</div>
          <div className="mt-1 text-3xl font-extrabold text-white tabular-nums">
            {red7.avgMs !== null ? fmtDur(red7.avgMs) : "—"}
          </div>
          <div className="text-[10.5px] text-white/45">
            {red7.episodes} episodios · {red7.openReds} abiertos
          </div>
        </div>
      </section>

      {limbos > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-[12.5px] text-amber-100">
          ⚠️ {limbos} lead{limbos !== 1 ? "s" : ""} sin próxima jugada (limbo) — el anti-limbo
          los sanará al registrar su próxima acción.
        </div>
      )}

      {/* Rojos por persona */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-white/85 border-b border-white/10">
          Rojos por persona asignada
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-white/5">
            {[...porPersona.entries()].sort((a, b) => b[1] - a[1]).map(([who, n]) => (
              <tr key={who}>
                <td className="py-2 px-4 text-white/80">{who}</td>
                <td className="py-2 px-4 text-right text-red-300 font-bold tabular-nums">{n}</td>
              </tr>
            ))}
            {porPersona.size === 0 && (
              <tr><td className="py-4 px-4 text-center text-white/40 italic">Sin rojos ahora mismo 🎉</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Lista de rojos actuales */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-white/85 border-b border-white/10">
          Rojos actuales ({rojos.length}) — orden: 💰 → 💬 → 🆕 → 🎓 → 📅, luego antigüedad
        </div>
        <div className="divide-y divide-white/5">
          {rojosOrdenados.slice(0, 100).map(r => {
            const info = leadInfo.get(r.leadId);
            const cid = info?.closer_id;
            return (
              <Link
                key={r.leadId}
                href={`/admin/leads/${r.leadId}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-white font-semibold min-w-0 truncate">{info?.name ?? "Lead"}</span>
                <span className="text-[12px] font-bold text-red-300 whitespace-nowrap">{r.badge}</span>
                <span className="text-[12px] text-white/50 min-w-0 truncate flex-1">{r.detalle}</span>
                {r.triggerAt && (
                  <span className="text-[11px] text-white/40 whitespace-nowrap">{fmtAgo(r.triggerAt)}</span>
                )}
                <span className="text-[11px] text-white/55 whitespace-nowrap">
                  {cid ? `→ ${closerName.get(cid) ?? "closer"}` : "→ sin asignar"}
                </span>
              </Link>
            );
          })}
          {rojos.length === 0 && (
            <div className="py-6 text-center text-white/40 italic text-sm">
              Cola limpia — nadie espera nada de nosotros ahora mismo ✅
            </div>
          )}
        </div>
      </section>

      <div className="text-center text-[10.5px] text-white/30">
        Calculado en vivo · transiciones fotografiadas cada 10 min por el cron observador ·
        trace por lead: /api/internal/lead/:id/semaforo-trace
      </div>
    </div>
  );
}
