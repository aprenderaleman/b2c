"use client";

import { useState, useTransition } from "react";
import { saveTemplateAction } from "./actions";
import type { MessageStats, Template } from "@/lib/message-stats";
import type { KindCatalogEntry } from "@/lib/message-catalog";

/**
 * Fila colapsable por kind+channel: stats arriba, "Ver muestras" y
 * "Editar plantilla" debajo. Edición solo si el catálogo dice
 * `editable: true` (el código del kind lee de message_templates).
 */
export function MessageRow({
  stats, catalog, template,
}: {
  stats:    MessageStats;
  catalog?: KindCatalogEntry;
  template: Template | null;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const rate = stats.responseRate;
  const { emailBlind, immatureCohort, summaryContent } = stats.reliability;
  const rateUnreliable = emailBlind;
  const rateColor =
    rateUnreliable ? "text-white/40" :
    stats.sentMature === 0 ? "text-white/40" :
    rate >= 25 ? "text-emerald-300" :
    rate >= 10 ? "text-amber-300" :
                 "text-red-300";

  const editable = catalog?.editable ?? false;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03]"
      >
        <span className="text-white/40 text-xs">{open ? "▼" : "▶"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">
              {catalog?.name ?? "(sin catálogo)"}
            </span>
            <span className="font-mono text-[11px] text-white/40">
              {stats.kind}{stats.sub_n != null && ` · #${stats.sub_n}`} · {stats.channel}
            </span>
            {editable && (
              <span className="text-[10px] uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-200 px-2 py-0.5">
                editable
              </span>
            )}
            {!editable && (
              <span className="text-[10px] uppercase tracking-wider rounded-full bg-slate-500/20 text-slate-300 px-2 py-0.5">
                código
              </span>
            )}
          </div>
          {catalog?.description && (
            <div className="mt-0.5 text-xs text-white/55">{catalog.description}</div>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 text-right">
          <div>
            <div className="text-[10px] uppercase text-white/40">Enviados</div>
            <div className="text-base font-bold text-white tabular-nums">{stats.sent}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-white/40">Respondidos</div>
            <div className="text-base font-bold text-white tabular-nums">{stats.responded7d}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-white/40">
              Tasa {immatureCohort && <span title="Cohorte parcialmente inmadura — algunos envíos aún no han tenido ventana de 7d completa">⚠</span>}
            </div>
            <div className={`text-base font-bold tabular-nums ${rateColor}`}>
              {rateUnreliable ? "N/A" : stats.sentMature > 0 ? `${rate.toFixed(1)}%` : "—"}
            </div>
            {stats.sent !== stats.sentMature && (
              <div className="text-[9px] text-white/40 tabular-nums">
                sobre {stats.sentMature} maduros
              </div>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/10 p-3 space-y-3">
          {/* Banner de advertencias de fiabilidad — solo aparece si aplica. */}
          {(emailBlind || immatureCohort || summaryContent) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
              {emailBlind && (
                <div>📧 <strong>Tasa no medible:</strong> el canal email no registra respuestas en lead_timeline.
                  Una respuesta del lead vía email NO la detectamos — el “0%” o similar no refleja efectividad real.</div>
              )}
              {immatureCohort && (
                <div>⏳ <strong>Cohorte parcialmente inmadura:</strong> {stats.sent - stats.sentMature} de {stats.sent}
                  envíos tienen menos de 7d — aún pueden generar respuesta. La tasa se calcula solo sobre los {stats.sentMature} maduros.</div>
              )}
              {summaryContent && (
                <div>📋 <strong>Muestras son resumen, no el texto real:</strong> el cron que envía estos mensajes guarda
                  un resumen en lead_timeline (ej. “Followup #4 enviado”) en vez del cuerpo. Para ver el texto exacto, mira la
                  plantilla en código (o edítala desde aquí si está marcada como editable).</div>
              )}
            </div>
          )}

          {/* Muestras */}
          {stats.samples.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/45 mb-1">
                Últimos {stats.samples.length} mensajes
                {summaryContent && <span className="ml-1 text-amber-400">(resumen, no cuerpo)</span>}
              </div>
              <div className="space-y-1.5">
                {stats.samples.map((s, i) => (
                  <div key={i} className="rounded-md bg-white/[0.03] border border-white/5 px-2.5 py-1.5">
                    <div className="text-[10px] text-white/40 tabular-nums">
                      {new Date(s.at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })}
                      {!s.isRealBody && <span className="ml-2 text-amber-400/70">resumen</span>}
                    </div>
                    <div className="text-sm text-white/85 whitespace-pre-wrap break-words">{s.preview || "(sin contenido)"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {catalog && (
            <div className="text-xs text-white/55">
              <strong>Código:</strong> <span className="font-mono">{catalog.codePath}</span>
              {catalog.placeholders.length > 0 && (
                <>
                  <br />
                  <strong>Placeholders:</strong>{" "}
                  {catalog.placeholders.map(p => (
                    <span key={p} className="inline-block font-mono bg-white/5 px-1.5 py-0.5 rounded text-[11px] mr-1">{`{${p}}`}</span>
                  ))}
                </>
              )}
            </div>
          )}

          {editable && catalog && (
            <div>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs font-semibold rounded-full border border-warm/40 bg-warm/15 text-warm-foreground px-3 py-1.5 hover:bg-warm/25"
                >
                  ✏️ Editar plantilla
                </button>
              ) : (
                <EditForm
                  catalog={catalog}
                  channel={stats.channel}
                  sub_n={stats.sub_n}
                  current={template}
                  onClose={() => setEditing(false)}
                />
              )}
            </div>
          )}
          {!editable && catalog && (
            <div className="text-[11px] text-amber-300/80">
              ⚠️ Plantilla aún no migrada al editor. Para cambiarla, modifica el archivo en {catalog.codePath}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditForm({
  catalog, channel, sub_n, current, onClose,
}: {
  catalog: KindCatalogEntry;
  channel: string;
  sub_n:   number | null;
  current: Template | null;
  onClose: () => void;
}) {
  const [body, setBody] = useState(current?.body ?? "");
  const [active, setActive] = useState(current?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Channel: si stats da 'wa+email' lo guardamos como 'both'.
  const normalizedChannel: "whatsapp" | "email" | "both" =
    channel === "email" ? "email" :
    channel === "whatsapp" || channel === "wa" ? "whatsapp" :
    "both";

  const save = () => {
    setErr(null);
    startTransition(async () => {
      try {
        await saveTemplateAction({
          kind:         catalog.kind,
          sub_n:        sub_n,
          channel:      normalizedChannel,
          name:         catalog.name,
          description:  catalog.description,
          body:         body,
          placeholders: catalog.placeholders,
          active,
        });
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al guardar.");
      }
    });
  };

  return (
    <div className="rounded-lg border border-warm/30 bg-warm/5 p-3">
      <div className="text-xs text-white/70 mb-2">
        Edita el cuerpo. Usa placeholders entre llaves: {catalog.placeholders.map(p => <code key={p} className="font-mono mx-0.5">{`{${p}}`}</code>)}.
      </div>
      <textarea
        value={body} onChange={e => setBody(e.target.value)}
        rows={10}
        className="w-full rounded-md bg-slate-900 text-slate-100 text-sm font-mono p-3 border border-white/10"
        placeholder="Cuerpo del mensaje..."
      />
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <label className="text-xs text-white/70 inline-flex items-center gap-1.5">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Activa (si la desactivas, el código usa el hardcoded original)
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={pending}
            className="text-xs rounded-full border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/10 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={pending || !body.trim()}
            className="text-xs font-semibold rounded-full bg-emerald-500 text-white px-3 py-1.5 hover:bg-emerald-600 disabled:opacity-50">
            {pending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
      {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
    </div>
  );
}
