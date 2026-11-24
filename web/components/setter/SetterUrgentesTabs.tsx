"use client";

import Link from "next/link";
import { useState } from "react";
import type { UrgenteItem } from "@/lib/setter-urgentes";
import type { SetterQueueItem } from "@/lib/setter-queue";
import { buildGuion, buildEnlaceMsg, type GuionTipo } from "@/lib/setter-scripts";

/**
 * Pestañas de "Leads Urgentes" (Gelfis 2026-11-22/24), en el ORDEN DE
 * TRABAJO del setter: 1 Trials de hoy → 2 Leads nuevos → 3 Trials de
 * mañana → 4 No asistieron. Cada fila lleva su "📋 Guion" (estilo
 * Hormozi, lib/setter-scripts.ts) con los datos del lead ya rellenos.
 */

const ACTION_LABELS: Record<string, string> = {
  confirmar_cita: "confirmó",
  no_contesto:    "no contestó",
  reagendar:      "reagendó",
  llamada:        "llamada",
  whatsapp:       "WhatsApp",
};

function fmtHoraBerlin(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
  });
}

function fmtFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", day: "numeric", month: "short",
  });
}

function fmtDiaLargo(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "short",
  });
}

/** Pill del último contacto: verde fresco, ámbar 3-5 días, rojo 6+ / nunca. */
function contactoPill(it: UrgenteItem): { text: string; cls: string } {
  if (!it.lastContact) {
    return {
      text: "Sin contactar nunca",
      cls: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
    };
  }
  const d = it.daysSinceContact ?? 0;
  const accion = ACTION_LABELS[it.lastContact.action_type] ?? it.lastContact.action_type.replace(/_/g, " ");
  const cuando = d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
  const text = `Último toque: ${cuando} (${fmtFechaCorta(it.lastContact.occurred_at)}) · ${accion}`;
  const cls =
    d >= 6 ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300" :
    d >= 3 ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" :
             "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  return { text, cls };
}

/** "agendó hace 25 min / 3 h / 2 días" para Leads nuevos. */
function hace(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

type TabKey = "hoy" | "calientes" | "manana" | "no_show";

/** Botón que copia el mensaje con el enlace del aula (lead lo pide). */
function EnlaceButton({ nombre, fecha, enlace }: { nombre: string | null; fecha: string; enlace: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copiar mensaje con el enlace de la clase"
      onClick={() => {
        try {
          navigator.clipboard.writeText(buildEnlaceMsg({
            nombre: (nombre ?? "").split(/\s+/)[0] || "Hola",
            fecha, enlace,
          }));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard bloqueado — abrir el guion y copiar a mano */ }
      }}
      className="btn-secondary text-[11px] px-2 py-1"
    >
      {copied ? "✓ Copiado" : "🔗 Enlace"}
    </button>
  );
}

/** Panel desplegable con el guion relleno + botón copiar. */
function GuionPanel({ tipo, nombre, dia, hora }: {
  tipo: GuionTipo; nombre: string | null; dia: string; hora: string;
}) {
  const [copied, setCopied] = useState(false);
  const g = buildGuion(tipo, {
    nombre: (nombre ?? "").split(/\s+/)[0] || "Hola",
    dia, hora,
  });
  return (
    <div className="mx-4 mb-3 rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-brand-700 dark:text-brand-300">{g.titulo}</span>
        <button
          type="button"
          onClick={() => {
            try {
              navigator.clipboard.writeText(g.texto);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch { /* clipboard bloqueado — se copia a mano */ }
          }}
          className="btn-secondary text-[11px] px-2 py-1 shrink-0"
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{g.texto}</p>
      <p className="text-[10px] text-amber-700 dark:text-amber-300">{g.reglas}</p>
    </div>
  );
}

export function SetterUrgentesTabs({ hoy, manana, calientes, noShows, snoozedNoShows, noShowBacklog }: {
  hoy: UrgenteItem[]; manana: UrgenteItem[]; calientes: UrgenteItem[];
  noShows: SetterQueueItem[]; snoozedNoShows: number; noShowBacklog: number;
}) {
  const [active, setActive] = useState<TabKey>("hoy");
  const [guionOpen, setGuionOpen] = useState<string | null>(null); // classId abierto

  const items = active === "hoy" ? hoy : active === "manana" ? manana : active === "calientes" ? calientes : [];

  /** Qué guion toca en cada pestaña (en hoy/mañana depende de si confirmó). */
  const tipoFor = (it: UrgenteItem): GuionTipo =>
    active === "calientes" ? "nuevo" : it.confirmada ? "refresh" : "recordatorio";

  const toggleGuion = (id: string) => setGuionOpen(g => (g === id ? null : id));

  return (
    <section className="space-y-3">
      {/* Orden de trabajo — siempre visible (Gelfis 2026-11-24). */}
      <p className="rounded-xl bg-slate-100 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
        <strong>¿Por dónde empiezo?</strong> Trabaja las pestañas en orden, de izquierda a derecha,
        y cada lista de arriba hacia abajo. En cada lead: toca <strong>📋 Guion</strong>, llama, y registra la acción en su ficha.
      </p>

      <div className="flex flex-wrap gap-2" role="tablist">
        {([
          { key: "hoy" as const,       label: "1️⃣ 📅 Trials de hoy",    count: hoy.length },
          { key: "calientes" as const, label: "2️⃣ 🔥 Leads nuevos",     count: calientes.length },
          { key: "manana" as const,    label: "3️⃣ 🌅 Trials de mañana", count: manana.length },
          { key: "no_show" as const,   label: "4️⃣ 🔄 No asistieron",    count: noShows.length },
        ]).map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => { setActive(t.key); setGuionOpen(null); }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border transition-colors ${
                isActive
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                isActive ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {active === "calientes"
          ? "Acaban de agendar y nadie los ha contactado todavía. Llámalos lo antes posible — el más reciente primero."
          : active === "no_show"
          ? "Tu lote de recuperación: los más recientes primero. Llama y envíale el enlace de reagenda — al trabajar uno, entra el siguiente solo."
          : "Todas las citas del día, hayan confirmado o no. Si el último toque fue hace días (ámbar/rojo), dale un toque más antes de la clase."}
      </p>

      {active === "no_show" ? (
        noShows.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No hay no-shows pendientes de recuperar.</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {noShows.map((it) => (
              <div key={it.classId}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <Link href={`/setter/leads/${it.leadId}`} className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem] hover:text-brand-600 dark:hover:text-brand-400">
                    {it.lead.name ?? "(sin nombre)"}
                  </Link>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {fmtFechaCorta(it.citaAt)} · {fmtHoraBerlin(it.citaAt)}
                    {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
                  </span>
                  {it.sinMarcar && (
                    <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                      sin marcar
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {it.lastSetterContact
                        ? `Último toque: ${fmtFechaCorta(it.lastSetterContact.occurred_at)}`
                        : "Sin contactar"}
                    </span>
                    <button type="button" onClick={() => toggleGuion(it.classId)} className="btn-secondary text-[11px] px-2 py-1">
                      📋 Guion
                    </button>
                  </span>
                </div>
                {guionOpen === it.classId && (
                  <GuionPanel
                    tipo="rescate"
                    nombre={it.lead.name}
                    dia={fmtDiaLargo(it.citaAt)}
                    hora={fmtHoraBerlin(it.citaAt)}
                  />
                )}
              </div>
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          {active === "calientes"
            ? "Todos los recién agendados ya fueron contactados 🔥✅"
            : active === "hoy" ? "No hay trials hoy." : "No hay trials mañana."}
        </p>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((it) => {
            const pill = contactoPill(it);
            return (
              <div key={it.classId}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {active === "calientes"
                      ? `${fmtFechaCorta(it.citaAt)} · ${fmtHoraBerlin(it.citaAt)}`
                      : fmtHoraBerlin(it.citaAt)}
                  </span>
                  <Link href={`/setter/leads/${it.leadId}`} className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem] hover:text-brand-600 dark:hover:text-brand-400">
                    {it.lead.name ?? "(sin nombre)"}
                  </Link>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
                    {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
                  </span>
                  {it.confirmada ? (
                    <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium">
                      ✅ confirmó
                    </span>
                  ) : (
                    <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                      sin confirmar
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {active === "calientes" ? (
                      <span className="text-xs rounded-full px-2.5 py-1 font-semibold bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300">
                        🔥 Agendó {hace(it.bookedAt)} · sin contactar
                      </span>
                    ) : (
                      <span className={`text-xs rounded-full px-2.5 py-1 font-medium ${pill.cls}`}>
                        {pill.text}
                      </span>
                    )}
                    {it.joinUrl && (
                      <EnlaceButton
                        nombre={it.lead.name}
                        fecha={`${active === "hoy" ? "hoy" : active === "manana" ? "mañana" : fmtDiaLargo(it.citaAt)} a las ${fmtHoraBerlin(it.citaAt)} (hora de Alemania)`}
                        enlace={it.joinUrl}
                      />
                    )}
                    <button type="button" onClick={() => toggleGuion(it.classId)} className="btn-secondary text-[11px] px-2 py-1">
                      📋 Guion
                    </button>
                  </span>
                </div>
                {guionOpen === it.classId && (
                  <GuionPanel
                    tipo={tipoFor(it)}
                    nombre={it.lead.name}
                    dia={active === "hoy" ? "hoy" : active === "manana" ? "mañana" : fmtDiaLargo(it.citaAt)}
                    hora={fmtHoraBerlin(it.citaAt)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {active === "no_show" && noShowBacklog > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          📦 {noShowBacklog} más esperan en el backlog — entran solos a tu lista a medida que trabajas estos.
        </p>
      )}
      {active === "no_show" && snoozedNoShows > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          ⏸️ {snoozedNoShows} en espera tras &quot;no contestó&quot; — vuelven solos a la lista a las 24h.
        </p>
      )}
    </section>
  );
}
