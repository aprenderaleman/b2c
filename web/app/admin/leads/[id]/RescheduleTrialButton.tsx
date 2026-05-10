"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón "Reagendar clase de prueba" en /admin/leads/[id]. Abre un
 * modal con un input <datetime-local>, valida y envía POST a
 * /api/admin/leads/[id]/reschedule-trial. En éxito refresca la página.
 *
 * UX:
 *   - Un solo input de fecha/hora.
 *   - Al cambiarlo, debounced GET al endpoint /check para detectar:
 *     · Colisión con otra clase del mismo profe (BLOQUEA confirm)
 *     · Fuera de la disponibilidad declarada en /profesor/disponibilidad
 *       → muestra warning amarillo, NO bloquea
 *     · Solapa con un evento de Google Calendar de Gelfis (cuando el
 *       profe es Gelfis) → warning amarillo, NO bloquea
 *   - Si hay warnings (no colisión), botón se renombra a "Reagendar
 *     de todas formas" y queda en color ámbar para que se note.
 */
export function RescheduleTrialButton({
  leadId,
  classId,
  currentScheduledAtIso,
  currentScheduledLabel,
}: {
  leadId:                 string;
  classId:                string;
  currentScheduledAtIso:  string;
  currentScheduledLabel:  string;
}) {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [err, setErr]                 = useState<string | null>(null);
  const [newDt, setNewDt]             = useState<string>(() => isoToLocalInput(currentScheduledAtIso));

  type CheckState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok";       warnings: string[]; collision: boolean; collisionTitles: string[] };
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });

  // Debounced check al cambiar el input — pega al backend para
  // detectar colisión / fuera-de-disponibilidad / busy de calendar.
  useEffect(() => {
    if (!open) return;
    const newIso = localInputToIso(newDt);
    if (!newIso) { setCheck({ kind: "idle" }); return; }
    if (new Date(newIso).getTime() <= Date.now()) {
      setCheck({ kind: "idle" }); return;
    }
    setCheck({ kind: "loading" });
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const u = new URL(`/api/admin/leads/${leadId}/reschedule-trial/check`, window.location.origin);
        u.searchParams.set("class_id",      classId);
        u.searchParams.set("new_start_iso", newIso);
        const res = await fetch(u.toString());
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setCheck({ kind: "idle" });
          return;
        }
        setCheck({
          kind:      "ok",
          warnings:  data.warnings ?? [],
          collision: !!data.collision,
          collisionTitles: (data.collision_with ?? []).map((x: { title?: string }) => x.title || "(otra clase)"),
        });
      } catch {
        if (!cancelled) setCheck({ kind: "idle" });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, newDt, classId, leadId]);

  async function submit() {
    setErr(null);
    if (!newDt) { setErr("Elige fecha y hora."); return; }
    const newIso = localInputToIso(newDt);
    if (!newIso) { setErr("Fecha inválida."); return; }
    if (new Date(newIso).getTime() <= Date.now()) {
      setErr("La nueva fecha debe ser en el futuro."); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/reschedule-trial`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ class_id: classId, new_start_iso: newIso }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message ?? data.error ?? "No se pudo reagendar.");
        setSubmitting(false);
        return;
      }
      // Cerramos modal + refresh para que el panel muestre el nuevo horario.
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setErr(null); setOpen(true); }}
        className="text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 transition"
      >
        🗓 Reagendar clase
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Reagendar clase de prueba
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Actual: <strong>{currentScheduledLabel}</strong>
            </p>

            <label className="block mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nueva fecha y hora <span className="text-[10px] font-normal normal-case">(zona Berlín)</span>
            </label>
            <input
              type="datetime-local"
              value={newDt}
              onChange={(e) => setNewDt(e.target.value)}
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
            />

            {/* Resultado del check de disponibilidad */}
            {check.kind === "loading" && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" aria-hidden />
                Comprobando disponibilidad…
              </p>
            )}
            {check.kind === "ok" && check.collision && (
              <div className="mt-3 rounded-lg border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
                <p className="font-semibold">⛔ Conflicto bloqueante</p>
                <p className="mt-1">
                  El profesor ya tiene otra clase agendada a esa hora
                  {check.collisionTitles.length > 0 && (
                    <> (<em>{check.collisionTitles.join(", ")}</em>)</>
                  )}
                  . Elige otro horario.
                </p>
              </div>
            )}
            {check.kind === "ok" && !check.collision && check.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold">⚠ Atención</p>
                <ul className="mt-1 space-y-1 list-disc list-inside">
                  {check.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <p className="mt-2 text-[11px] opacity-80">
                  Puedes reagendar igualmente — solo es un aviso para que decidas
                  con la información completa.
                </p>
              </div>
            )}

            {err && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                {err}
              </p>
            )}

            <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Al confirmar: actualizamos la BD, sincronizamos tu Google Calendar
              y enviamos al lead un WhatsApp + email con la nueva hora pidiéndole
              que confirme.
            </p>

            {(() => {
              const blocked   = check.kind === "ok" && check.collision;
              const hasWarn   = check.kind === "ok" && !check.collision && check.warnings.length > 0;
              const btnLabel  = hasWarn ? "Reagendar de todas formas" : "Reagendar y notificar";
              const btnColor  = blocked
                ? "bg-slate-400 cursor-not-allowed"
                : hasWarn
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-sky-600 hover:bg-sky-700";
              return (
                <div className="mt-5 flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || blocked}
                    className={`text-sm font-semibold rounded-lg ${btnColor} text-white px-3 py-1.5 disabled:opacity-60 inline-flex items-center gap-2`}
                  >
                    {submitting && (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden />
                    )}
                    {btnLabel}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * ISO timestamp (UTC) → string para `<input type="datetime-local">`,
 * formateado en hora local del navegador (lo que el admin "ve" en su
 * reloj). El backend luego interpreta el string como hora local y lo
 * convierte a UTC. Para evitar ambigüedad por DST, usamos getX() en
 * la zona del navegador del admin — Gelfis está en Berlín, así que
 * coincide con la zona de la academia. Si en el futuro hay admins en
 * otra TZ, conviene mostrar el offset visible.
 */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-05-09T15:00" (local) → ISO UTC. Usa Date directly; el
 *  navegador interpreta el string como hora local. */
function localInputToIso(local: string): string | null {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
