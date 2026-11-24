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

type Mode = "confirmado" | "enlace_clase" | "reagendar" | "no_contesto" | "nota" | "descartar" | "sin_wa";

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
    cta: "Registrar y preparar WhatsApp",
    pendingCta: "Preparando…",
    preview: "Al registrar: el correo con enlace sale solo, y arriba te aparecerá el mensaje de WhatsApp listo (botón para abrir WhatsApp con el texto ya escrito — solo pulsas Enviar).",
  },
  enlace_clase: {
    title: "🎓 Enviar enlace de acceso a la clase",
    noteLabel: "Nota (obligatoria)",
    defaultNote: "Pidió el enlace de acceso al aula",
    placeholder: "Ej: Me pidió el enlace para entrar desde el móvil.",
    cta: "Preparar envío",
    pendingCta: "Preparando…",
    preview: "El correo con el enlace sale solo, y arriba te aparecerá el mensaje de WhatsApp listo para que lo envíes tú manual (botón para abrir WhatsApp con el texto ya escrito).",
  },
  reagendar: {
    title: "🔗 Enviar enlace de reagenda",
    noteLabel: "Nota (opcional) — qué pasó en la llamada",
    defaultNote: "Lead pidió reagendar (1-click)",
    placeholder: "Ej: No puede a esa hora, quedamos en que elige nuevo horario con el enlace.",
    cta: "Registrar y preparar WhatsApp",
    pendingCta: "Preparando…",
    preview: "Se cancela la cita actual y se libera el hueco del profe. El correo con el enlace de reagenda sale solo, y arriba te aparecerá el mensaje de WhatsApp listo para enviar tú manual.",
  },
  no_contesto: {
    title: "📵 No contestó",
    noteLabel: "Nota",
    defaultNote: "No contestó la llamada",
    placeholder: "Ej: No contestó, buzón de voz.",
    cta: "Registrar y preparar WhatsApp",
    pendingCta: "Preparando…",
    preview: "Al registrar te aparece el mensaje de WhatsApp listo para enviar tú manual: si tiene cita futura, pide el confirmo con un “Sí”; si fue no-show, lleva el enlace para reagendar. Tú pulsas el botón que abre WhatsApp con el texto ya escrito.",
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
  sin_wa: {
    title: "🚫 No tiene WhatsApp",
    noteLabel: "Nota (obligatoria) — qué comprobaste",
    defaultNote: "El número no existe en WhatsApp",
    placeholder: "Ej: El número no existe en WhatsApp, intenté llamar y tampoco.",
    cta: "Marcar sin WhatsApp",
    pendingCta: "Marcando…",
    preview: "El lead sale de tus listas (no puedes contactarlo por WA) y el profe verá el tag 🚫 Sin WhatsApp en su ficha. Su clase SIGUE en pie y los correos le siguen llegando — no es un descarte.",
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
  tieneCitas = true,
}: {
  leadId: string;
  citaTipo: "trial" | "sesion";
  /** true si la cita aún no pasó — habilita los envíos de acceso. */
  citaFutura: boolean;
  /** false para leads sin ninguna cita (buscador global): se ocultan
   *  las acciones que dependen de una cita. */
  tieneCitas?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [motivo, setMotivo] = useState<"no_agendo" | "numero_equivocado">("no_agendo");
  // Refactor 2026-11-14 (post-bans v5+v6): el WA queda PREPARADO y la
  // setter lo envía manual. Esto guarda el texto y el wa.me link.
  const [manualWa, setManualWa] = useState<{ text: string; link: string } | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const open = (m: Mode) => {
    setMode(m);
    setNote(MODE_CONFIG[m].defaultNote);
    setError(null);
    setOkMsg(null);
    setManualWa(null);
  };

  // Refactor 2026-11-14: para las 3 acciones WA (confirmado, enlace_clase,
  // no_contesto) el click del botón dispara DIRECTO el backend con la nota
  // por defecto; el modal se abre YA en modo "éxito + caja ámbar" — un clic
  // menos para Sheila.
  const openAndRun = (m: Mode) => {
    // Confirm obligatorio para TODAS las acciones (Gelfis 2026-11-14):
    // click accidental = acción irreversible para el lead y el profe.
    const confirmMsg: Record<Mode, string | null> = {
      confirmado:
        "✅ Confirmar que el lead te dijo SÍ en la llamada.\n\n• Quedará como '✅ Confirmado 📞' en el panel del profe.\n• Se le envía gracias por WhatsApp + email con el enlace al aula.\n\n¿Continuar?",
      enlace_clase:
        "🎓 Enviar al lead el enlace para entrar al aula.\n\n• Correo automático con el enlace.\n• WhatsApp manual listo para que lo envíes tú.\n\n¿Continuar?",
      reagendar:
        "⚠️ Esto CANCELA la clase del lead y libera el hueco del profe (no se puede deshacer).\n\n¿Enviar el enlace de reagenda?",
      no_contesto:
        "📵 Registrar que no contestó la llamada.\n\n• WhatsApp manual listo para que lo envíes tú (pide confirmo o manda reagenda si fue no-show).\n• El lead vuelve a tu cola en 24h.\n\n¿Continuar?",
      nota: null,
      descartar: null,
      sin_wa: null,
    };
    const msg = confirmMsg[m];
    if (msg && !window.confirm(msg)) return;
    setMode(m);
    setNote(MODE_CONFIG[m].defaultNote);
    setError(null);
    setOkMsg(null);
    setManualWa(null);
    runSubmit(m, MODE_CONFIG[m].defaultNote);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 2000);
    } catch { /* ignorar: wa.me ya lleva el texto */ }
  };

  const submit = () => {
    if (!mode) return;
    runSubmit(mode, note);
  };

  const runSubmit = (currentMode: Mode, currentNote: string) => {
    setError(null);
    if (currentNote.trim().length < 5) {
      setError("La nota es obligatoria (mínimo 5 caracteres).");
      return;
    }
    start(async () => {
      let res: Response;
      if (currentMode === "confirmado") {
        res = await fetch(`/api/setter/leads/${leadId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: currentNote.trim() }),
        });
      } else if (currentMode === "enlace_clase") {
        res = await fetch(`/api/setter/leads/${leadId}/send-class-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: currentNote.trim() }),
        });
      } else if (currentMode === "reagendar") {
        res = await fetch(`/api/setter/leads/${leadId}/send-reschedule-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: citaTipo, note: currentNote.trim() }),
        });
      } else if (currentMode === "no_contesto") {
        res = await fetch(`/api/setter/leads/${leadId}/no-contesto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: currentNote.trim() }),
        });
      } else if (currentMode === "descartar") {
        res = await fetch(`/api/setter/leads/${leadId}/descartar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo, note: currentNote.trim() }),
        });
      } else if (currentMode === "sin_wa") {
        res = await fetch(`/api/setter/leads/${leadId}/sin-whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: currentNote.trim() }),
        });
      } else {
        res = await fetch("/api/contacts/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            actionType: "nota_libre",
            channel: "otro",
            note: currentNote.trim(),
          }),
        });
      }
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((body?.message as string) ?? (body?.error as string) ?? "No se pudo registrar.");
        return;
      }
      // Refactor 2026-11-14 (post-bans v5+v6): si el backend devuelve
      // pending_manual + wa_link, abrir la caja de envío manual.
      const bodyManual = body as { pending_manual?: boolean; wa_text?: string | null; wa_link?: string | null };
      if (bodyManual.pending_manual && bodyManual.wa_link && bodyManual.wa_text) {
        setManualWa({ text: bodyManual.wa_text, link: bodyManual.wa_link });
      }

      if (mode === "confirmado") {
        const email = (body as { email_sent?: boolean }).email_sent;
        setOkMsg(bodyManual.pending_manual
          ? `✅ Confirmo registrado. El mensaje de WhatsApp quedó listo abajo — ábrelo y pulsa Enviar.${email ? " (El correo ya salió.)" : ""}`
          : `✅ Confirmo registrado. El profe lo verá como confirmado. El lead sale de tu lista.`);
      } else if (mode === "enlace_clase") {
        const email = (body as { email_sent?: boolean }).email_sent;
        setOkMsg(bodyManual.pending_manual
          ? `🎓 Enlace listo abajo — ábrelo en WhatsApp y pulsa Enviar.${email ? " (El correo ya salió.)" : ""}`
          : `🎓 Enlace de acceso enviado.`);
      } else if (mode === "reagendar") {
        const email = (body as { email_sent?: boolean }).email_sent;
        setOkMsg(bodyManual.pending_manual
          ? `🔗 Reagenda preparada. El mensaje de WhatsApp quedó listo abajo — ábrelo y pulsa Enviar.${email ? " (El correo con el enlace ya salió.)" : ""}`
          : `🔗 Enlace de reagenda enviado${email ? " por correo" : ""}.`);
      } else if (mode === "no_contesto") {
        const b2 = body as { wa_sent?: boolean; variant?: string; send_reason?: string; pending_manual?: boolean };
        if (b2.pending_manual) {
          setOkMsg(b2.variant === "rescate"
            ? "📵 Registrado. El mensaje de reagenda quedó listo abajo — ábrelo y pulsa Enviar. El lead vuelve a tu lista en 24 horas."
            : "📵 Registrado. El mensaje de confirmación quedó listo abajo — ábrelo y pulsa Enviar. El lead vuelve a tu lista en 24h (o 2h antes de su clase).");
        } else {
          setOkMsg(b2.wa_sent
            ? (b2.variant === "rescate"
              ? "📵 Registrado y el enlace de reagenda salió por WhatsApp. El lead vuelve a tu lista en 24 horas."
              : "📵 Registrado y el confirmo salió por WhatsApp. El lead vuelve a tu lista en 24h.")
            : `📵 Registrado. El lead vuelve a tu lista en 24h. Sin mensaje de WhatsApp (${b2.send_reason ?? "no aplica"}).`);
        }
      } else if (mode === "descartar") {
        const n = (body as { citas_canceladas?: number }).citas_canceladas ?? 0;
        setOkMsg(`❌ Lead descartado — fuera de todas las listas${n > 0 ? ` y ${n} cita${n > 1 ? "s" : ""} cancelada${n > 1 ? "s" : ""} (hueco liberado)` : ""}. No recibirá más mensajes.`);
      } else if (mode === "sin_wa") {
        setOkMsg("🚫 Marcado sin WhatsApp. Sale de tus listas y el profe verá el tag. Su clase sigue en pie.");
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
        {tieneCitas && (
          <button
            type="button"
            onClick={() => openAndRun("confirmado")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-semibold transition-colors"
          >
            ✅ Confirmado
          </button>
        )}
        {citaFutura && (
          <button
            type="button"
            onClick={() => openAndRun("enlace_clase")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 px-4 py-2 text-sm font-medium transition-colors"
          >
            🎓 Enlace de clase
          </button>
        )}
        {tieneCitas && (
          <button
            type="button"
            onClick={() => openAndRun("reagendar")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20 px-4 py-2 text-sm font-medium transition-colors"
          >
            🔗 Reagendar
          </button>
        )}
        <button
          type="button"
          onClick={() => openAndRun("no_contesto")}
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
          onClick={() => open("sin_wa")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 px-4 py-2 text-sm font-medium transition-colors"
        >
          🚫 No tiene WA
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

            {pending && !okMsg && !error ? (
              <div className="py-6 flex flex-col items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <div className="h-6 w-6 rounded-full border-2 border-slate-300 border-t-emerald-600 animate-spin" />
                <span>Preparando…</span>
              </div>
            ) : okMsg ? (
              <>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">{okMsg}</p>

                {manualWa && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 p-3 space-y-3">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      💬 WhatsApp pendiente de tu envío manual
                    </p>
                    <textarea
                      readOnly
                      value={manualWa.text}
                      rows={7}
                      className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 p-2 font-mono leading-snug"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(manualWa.text)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        {copyFlash ? "✓ Copiado" : "📋 Copiar mensaje"}
                      </button>
                      <a
                        href={manualWa.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        💬 Abrir WhatsApp con mensaje listo
                      </a>
                    </div>
                    <p className="text-[11px] text-amber-700 dark:text-amber-200/80">
                      Abre WhatsApp Web (o el móvil) con el chat del lead y el texto ya pegado. Solo tienes que pulsar Enviar.
                    </p>
                  </div>
                )}

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
