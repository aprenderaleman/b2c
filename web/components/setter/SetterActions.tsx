"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Las acciones del setter en la ficha del lead (Gelfis 2026-10-24/26):
 *
 *   ✅ Confirmado      — registra el CONFIRMO (el lead sale de su lista)
 *                        y el lead recibe por WhatsApp (Stiv) + email:
 *                        gracias por confirmar + enlace + "Wir sehen uns
 *                        am {fecha}".
 *   🎓 Enlace de clase — Stiv + email le envían el enlace de acceso al
 *                        aula con instrucciones mínimas (solo citas
 *                        futuras).
 *   🔗 Reagendar       — Stiv envía el enlace de reagenda ("como
 *                        hablamos, aquí te envío el enlace…").
 *   📵 No contestó     — registra el intento; el lead vuelve a la lista
 *                        a las 24h o 2h antes de su clase.
 *   📝 Nota            — nota libre, visible para admin, profe y closer.
 *
 * Toda acción lleva nota (regla del rol); las rápidas la traen
 * pre-rellenada para que registrar sea un clic.
 */

type Mode = "confirmado" | "enlace_clase" | "reagendar" | "no_contesto" | "nota" | "descartar";

const MODE_CONFIG: Record<Mode, {
  title: string;
  noteLabel: string;
  defaultNote: string;
  placeholder: string;
  cta: string;
  pendingCta: string;
  preview?: string;
}> = {
  confirmado: {
    title: "✅ Lead confirmado",
    noteLabel: "Nota — qué dijo / qué quiere lograr",
    defaultNote: "Confirmó que asistirá ✅",
    placeholder: "Ej: Confirmó que asiste. Quiere alemán para trabajar en enfermería.",
    cta: "Registrar CONFIRMO y enviar",
    pendingCta: "Registrando…",
    preview: "Al registrar, el lead recibe por WhatsApp (Stiv) y correo: “¡Gracias por confirmar! 🙌” + su enlace para unirse + “Wir sehen uns am {fecha}”.",
  },
  enlace_clase: {
    title: "🎓 Enviar enlace de acceso a la clase",
    noteLabel: "Nota (obligatoria)",
    defaultNote: "Pidió el enlace de acceso al aula",
    placeholder: "Ej: Me pidió el enlace para entrar desde el móvil.",
    cta: "Enviar por WhatsApp + correo",
    pendingCta: "Enviando…",
    preview: "El lead recibe por WhatsApp (Stiv) y correo su enlace para entrar al aula + fecha + cómo entrar (clic en el enlace, sin instalar nada).",
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
    preview: "Stiv le escribe por WhatsApp de tu parte: si tiene cita futura, le pide el confirmo (“tu clase es el {fecha}, ¿me confirmas?”); si es un no-show, le envía el enlace para reagendar (“intenté llamarte… elige un nuevo horario aquí”).",
  },
  descartar: {
    title: "❌ Descartar lead",
    noteLabel: "Nota (obligatoria) — qué dijo exactamente",
    defaultNote: "",
    placeholder: "Ej: Dice que él no agendó nada, que debió ser otra persona con su número.",
    cta: "Descartar lead",
    pendingCta: "Descartando…",
    preview: "⚠️ El lead sale de TODAS las listas, su cita se cancela (se libera el hueco del profe) y no recibirá más mensajes. Úsalo solo cuando la cita no es real: no agendó, fue un error o número equivocado.",
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

function fmtCanales(body: { wa_sent?: boolean; email_sent?: boolean }): string {
  const canales = [body.wa_sent ? "WhatsApp" : null, body.email_sent ? "correo" : null].filter(Boolean);
  return canales.length > 0 ? canales.join(" y ") : "";
}

export function SetterActions({
  leadId,
  citaTipo,
  citaFutura,
}: {
  leadId: string;
  citaTipo: "trial" | "sesion";
  /** true si la cita aún no pasó — habilita los envíos de acceso. */
  citaFutura: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [motivo, setMotivo] = useState<"no_agendo" | "numero_equivocado">("no_agendo");

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
      if (mode === "confirmado") {
        res = await fetch(`/api/setter/leads/${leadId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        });
      } else if (mode === "enlace_clase") {
        res = await fetch(`/api/setter/leads/${leadId}/send-class-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        });
      } else if (mode === "reagendar") {
        res = await fetch(`/api/setter/leads/${leadId}/send-reschedule-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: citaTipo, note: note.trim() }),
        });
      } else if (mode === "no_contesto") {
        res = await fetch(`/api/setter/leads/${leadId}/no-contesto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        });
      } else if (mode === "descartar") {
        res = await fetch(`/api/setter/leads/${leadId}/descartar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo, note: note.trim() }),
        });
      } else {
        res = await fetch("/api/contacts/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            actionType: "nota_libre",
            channel: "otro",
            note: note.trim(),
          }),
        });
      }
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((body?.message as string) ?? (body?.error as string) ?? "No se pudo registrar.");
        return;
      }
      if (mode === "confirmado") {
        const canales = fmtCanales(body as { wa_sent?: boolean; email_sent?: boolean });
        setOkMsg(canales
          ? `✅ Confirmo registrado y mensaje de gracias + enlace enviado por ${canales}. El profe de la cita lo verá como confirmado. El lead sale de tu lista.`
          : `✅ Confirmo registrado y el profe lo verá — pero el mensaje NO se pudo enviar (${(body as { send_reason?: string }).send_reason ?? "sin canales"}). Avísale tú el enlace.`);
      } else if (mode === "enlace_clase") {
        const canales = fmtCanales(body as { wa_sent?: boolean; email_sent?: boolean });
        setOkMsg(`🎓 Enlace de acceso enviado por ${canales || "—"}.`);
      } else if (mode === "reagendar") {
        const canales = fmtCanales(body as { wa_sent?: boolean; email_sent?: boolean });
        setOkMsg(canales.includes("WhatsApp")
          ? `🔗 Enlace enviado por ${canales}. Cuando el lead elija su nuevo horario, la cita aparecerá agendada.`
          : `🔗 El WhatsApp no salió — el enlace se envió por ${canales || "ningún canal"}. Avísale al lead que lo busque en su correo.`);
      } else if (mode === "no_contesto") {
        const b2 = body as { wa_sent?: boolean; variant?: string; send_reason?: string };
        setOkMsg(b2.wa_sent
          ? (b2.variant === "rescate"
            ? "📵 Registrado y Stiv le envió el enlace de reagenda por WhatsApp. El lead vuelve a tu lista en 24 horas."
            : "📵 Registrado y Stiv le pidió el confirmo por WhatsApp. El lead vuelve a tu lista en 24 horas (o 2 horas antes de su clase).")
          : `📵 Registrado. El lead vuelve a tu lista en 24 horas (o 2 horas antes de su clase). Sin mensaje de WhatsApp (${b2.send_reason ?? "no aplica"}).`);
      } else if (mode === "descartar") {
        const n = (body as { citas_canceladas?: number }).citas_canceladas ?? 0;
        setOkMsg(`❌ Lead descartado — fuera de todas las listas${n > 0 ? ` y ${n} cita${n > 1 ? "s" : ""} cancelada${n > 1 ? "s" : ""} (hueco liberado)` : ""}. No recibirá más mensajes.`);
      } else {
        setOkMsg("📝 Nota guardada en el perfil del lead.");
      }
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
        {citaFutura && (
          <button
            type="button"
            onClick={() => open("enlace_clase")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 px-4 py-2 text-sm font-medium transition-colors"
          >
            🎓 Enlace de clase
          </button>
        )}
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
        <button
          type="button"
          onClick={() => open("descartar")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-4 py-2 text-sm font-medium transition-colors"
        >
          ❌ Descartar
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
                {cfg.preview && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-300">
                    {cfg.preview}
                  </div>
                )}
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

                {mode === "descartar" && (
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">Motivo</span>
                    <select
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value as "no_agendo" | "numero_equivocado")}
                      className="input-text mt-1 w-full"
                    >
                      <option value="no_agendo">Dice que no agendó / fue un error</option>
                      <option value="numero_equivocado">Número equivocado</option>
                    </select>
                  </label>
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
