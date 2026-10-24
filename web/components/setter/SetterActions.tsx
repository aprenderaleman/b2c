"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Las acciones del setter en la ficha del lead (Gelfis 2026-10-24):
 *
 *   ✅ Confirmado   — el lead confirmó que asiste → registra
 *                     confirmar_cita y el lead sale de su lista.
 *   🔗 Reagendar    — Stiv envía por WhatsApp el enlace de reagenda
 *                     ("como hablamos, aquí te envío el enlace…").
 *   📵 No contestó  — registra el intento; el lead baja de la lista y
 *                     vuelve a aparecer a las 24h o 2h antes de su clase.
 *   📝 Nota         — nota libre, visible en el perfil del lead para
 *                     admin, profe y closer.
 *
 * Toda acción lleva nota (regla del rol); Confirmado y No contestó la
 * traen pre-rellenada para que registrar sea un clic.
 */

type Mode = "confirmado" | "reagendar" | "no_contesto" | "nota";

const MODE_CONFIG: Record<Mode, {
  title: string;
  noteLabel: string;
  defaultNote: string;
  placeholder: string;
  cta: string;
  pendingCta: string;
}> = {
  confirmado: {
    title: "✅ Lead confirmado",
    noteLabel: "Nota — qué dijo / qué quiere lograr",
    defaultNote: "Confirmó que asistirá ✅",
    placeholder: "Ej: Confirmó que asiste. Quiere alemán para trabajar en enfermería.",
    cta: "Registrar CONFIRMO",
    pendingCta: "Registrando…",
  },
  reagendar: {
    title: "🔗 Enviar enlace de reagenda",
    noteLabel: "Nota (obligatoria) — qué pasó en la llamada",
    defaultNote: "",
    placeholder: "Ej: No puede a esa hora, quedamos en que elige nuevo horario con el enlace.",
    cta: "Enviar por WhatsApp (Stiv)",
    pendingCta: "Enviando…",
  },
  no_contesto: {
    title: "📵 No contestó",
    noteLabel: "Nota",
    defaultNote: "No contestó la llamada",
    placeholder: "Ej: No contestó, buzón de voz.",
    cta: "Registrar intento",
    pendingCta: "Registrando…",
  },
  nota: {
    title: "📝 Nota en el perfil del lead",
    noteLabel: "Nota (visible para admin, profe y closer)",
    defaultNote: "",
    placeholder: "Ej: Prefiere que lo llamen después de las 18:00. Tiene examen B1 en enero.",
    cta: "Guardar nota",
    pendingCta: "Guardando…",
  },
};

export function SetterActions({
  leadId,
  citaTipo,
  citaFutura,
}: {
  leadId: string;
  citaTipo: "trial" | "sesion";
  /** true si la cita aún no pasó — cambia el aviso del Reagendar. */
  citaFutura: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const open = (m: Mode) => {
    setMode(m);
    setNote(MODE_CONFIG[m].defaultNote);
    setError(null);
    setOkMsg(null);
  };

  const submit = () => {
    if (!mode) return;
    setError(null);
    if (note.trim().length < 5) {
      setError("La nota es obligatoria (mínimo 5 caracteres).");
      return;
    }
    start(async () => {
      let res: Response;
      if (mode === "reagendar") {
        res = await fetch(`/api/setter/leads/${leadId}/send-reschedule-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: citaTipo, note: note.trim() }),
        });
      } else {
        const actionType = mode === "confirmado" ? "confirmar_cita"
          : mode === "no_contesto" ? "no_contesto" : "nota_libre";
        res = await fetch("/api/contacts/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            actionType,
            channel: mode === "nota" ? "otro" : "llamada",
            note: note.trim(),
          }),
        });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "No se pudo registrar.");
        return;
      }
      setOkMsg(
        mode === "confirmado"
          ? "✅ Confirmo registrado — el lead sale de tu lista de pendientes."
          : mode === "reagendar"
          ? "🔗 Enlace enviado por WhatsApp. Cuando el lead elija su nuevo horario, la cita aparecerá agendada."
          : mode === "no_contesto"
          ? "📵 Registrado. El lead vuelve a tu lista en 24 horas (o 2 horas antes de su clase, lo que llegue primero)."
          : "📝 Nota guardada en el perfil del lead.",
      );
      router.refresh();
    });
  };

  const cfg = mode ? MODE_CONFIG[mode] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => open("confirmado")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-semibold transition-colors"
        >
          ✅ Confirmado
        </button>
        <button
          type="button"
          onClick={() => open("reagendar")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20 px-4 py-2 text-sm font-medium transition-colors"
        >
          🔗 Reagendar
        </button>
        <button
          type="button"
          onClick={() => open("no_contesto")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400 px-4 py-2 text-sm font-medium transition-colors"
        >
          📵 No contestó
        </button>
        <button
          type="button"
          onClick={() => open("nota")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400 px-4 py-2 text-sm font-medium transition-colors"
        >
          📝 Nota
        </button>
      </div>

      {mode && cfg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{cfg.title}</h3>

            {okMsg ? (
              <>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">{okMsg}</p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setMode(null)} className="btn-primary text-sm">Listo</button>
                </div>
              </>
            ) : (
              <>
                {mode === "reagendar" && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">Stiv enviará por WhatsApp:</p>
                    <p className="italic">
                      &quot;Como hablamos, aquí te envío el enlace para que reagendes tu{" "}
                      {citaTipo === "sesion" ? "sesión de plan" : "clase de prueba"} de alemán…&quot; + el enlace.
                    </p>
                    {citaFutura && (
                      <p className="text-amber-700 dark:text-amber-300">
                        ⚠️ Su cita actual se cancela para liberar el hueco — el lead elige una nueva con el enlace.
                      </p>
                    )}
                  </div>
                )}

                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{cfg.noteLabel}</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="input-text mt-1 w-full"
                    placeholder={cfg.placeholder}
                  />
                </label>

                {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setMode(null)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-2">
                    Cancelar
                  </button>
                  <button type="button" onClick={submit} disabled={pending} className="btn-primary text-sm">
                    {pending ? cfg.pendingCta : cfg.cta}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
