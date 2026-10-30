"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón flotante "✨ Asistente" + panel de chat (MVP — Gelfis 2026-10-07).
 *
 * El backend (/api/asistente) solo consulta y devuelve PROPUESTAS de
 * acción. Aquí se pintan como tarjetas; al pulsar Confirmar, este
 * componente llama al endpoint existente (el mismo del botón manual)
 * con la sesión del usuario. Nada se ejecuta sin ese clic.
 */

type Accion = {
  id:      string;
  tipo:    "agendar" | "reagendar" | "cancelar" | "mover" | "bloquear" | "mensaje";
  titulo:  string;
  lineas:  string[];
  nota:    string | null;
  hecho?:  string;
  request: { method: "POST" | "PATCH" | "DELETE"; url: string; body: Record<string, unknown> | null };
};
type AccionEstado = "pendiente" | "ejecutando" | "hecha" | "error" | "descartada";
type AccionUI = Accion & { estado: AccionEstado; error?: string };

type Msg = { id: string; role: "user" | "assistant"; text: string; acciones?: AccionUI[] };

type Rol = "student" | "teacher" | "admin";

type Lang = "es" | "de";

const SUGERENCIAS: Record<Lang, Record<Rol, string[]>> = {
  es: {
    student: ["¿Cuándo es mi próxima clase?", "¿Qué vimos en la última clase?", "Corrige esta frase: …", "¿Tengo tareas pendientes?"],
    teacher: ["¿Qué clases tengo mañana?", "Prepárame la clase con…", "Bloquea el viernes de 17 a 19", "Cambia el horario de…"],
    admin:   ["¿Qué clases hay hoy?", "Huecos libres de un profesor mañana", "Agenda una clase de… con…"],
  },
  de: {
    student: ["Wann ist meine nächste Stunde?", "Was haben wir letzte Stunde gemacht?", "Korrigiere diesen Satz: …", "Habe ich offene Aufgaben?"],
    teacher: ["Welche Stunden habe ich morgen?", "Bereite die Stunde mit … vor", "Blockiere Freitag von 17 bis 19 Uhr"],
    admin:   ["Welche Stunden gibt es heute?", "Freie Zeiten einer Lehrkraft morgen"],
  },
};

const T: Record<Lang, Record<string, string>> = {
  es: {
    sub: "Nada se ejecuta sin tu confirmación", nueva: "Nueva", hola: "Hola", intro: "Puedo consultar tus clases, ayudarte con el alemán y prepararte cambios; tú los confirmas.",
    pensando: "Pensando…", consultando: "Consultando…", escribe: "Escribe aquí…", enviar: "Enviar", confirmar: "Confirmar", reintentar: "Reintentar", descartar: "Descartar", descartada: "Descartada", momento: "Un momento…",
    errRespuesta: "No he podido responder. Inténtalo de nuevo.", errConexion: "Sin conexión. Inténtalo de nuevo.", errAccion: "No se pudo completar. Inténtalo de nuevo.",
    agendar: "Clase agendada", reagendar: "Clase reagendada", cancelar: "Clase cancelada", mover: "Clase movida", bloquear: "Hecho", mensaje: "Mensaje enviado",
  },
  de: {
    sub: "Nichts passiert ohne deine Bestätigung", nueva: "Neu", hola: "Hallo", intro: "Ich kann deine Stunden abfragen, dir bei Deutsch helfen und Änderungen vorbereiten; du bestätigst sie.",
    pensando: "Einen Moment…", consultando: "Ich schaue nach…", escribe: "Schreib hier…", enviar: "Senden", confirmar: "Bestätigen", reintentar: "Erneut versuchen", descartar: "Verwerfen", descartada: "Verworfen", momento: "Einen Moment…",
    errRespuesta: "Ich konnte nicht antworten. Versuch es noch einmal.", errConexion: "Keine Verbindung. Versuch es noch einmal.", errAccion: "Das hat nicht geklappt. Versuch es noch einmal.",
    agendar: "Stunde gebucht", reagendar: "Stunde verschoben", cancelar: "Stunde abgesagt", mover: "Stunde verschoben", bloquear: "Erledigt", mensaje: "Nachricht gesendet",
  },
};

const STORE_TTL_MS = 7 * 24 * 3600_000;
const STORE_MAX = 30;

/** Conversación en este navegador (7 días), por usuario. localStorage puede fallar: nunca rompe el chat. */
function loadStored(key: string): Msg[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const { at, msgs } = JSON.parse(raw) as { at: number; msgs: Msg[] };
    if (Date.now() - at > STORE_TTL_MS || !Array.isArray(msgs)) return [];
    return msgs.map(m => ({
      ...m,
      acciones: m.acciones?.map(a => a.estado === "ejecutando" ? { ...a, estado: "pendiente" as const } : a),
    }));
  } catch { return []; }
}
function saveStored(key: string, msgs: Msg[]) {
  try {
    if (msgs.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), msgs: msgs.slice(-STORE_MAX) }));
  } catch { /* sin almacenamiento: la conversación dura lo que la página */ }
}

/** Lo que el modelo ve de un mensaje pasado: texto + estado de sus tarjetas. */
function historyContent(m: Msg): string {
  const notas = (m.acciones ?? []).map(a => {
    const estado =
      a.estado === "hecha"      ? "CONFIRMADA por el usuario y ejecutada con éxito" :
      a.estado === "error"      ? `el usuario confirmó pero FALLÓ: ${a.error ?? "error"}` :
      a.estado === "descartada" ? "DESCARTADA por el usuario" :
                                  "pendiente, el usuario aún no ha pulsado Confirmar";
    return `[Propuesta «${a.titulo}»: ${a.lineas.join(" | ")} — ${estado}]`;
  });
  return [m.text, ...notas].filter(Boolean).join("\n");
}

/** **negrita** mínima; el resto se pinta tal cual con saltos de línea. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>)}
    </>
  );
}

export function AsistenteWidget({ rol, nombre, userId, lang = "es" }: { rol: Rol; nombre: string; userId: string; lang?: Lang }) {
  const router = useRouter();
  const t = T[lang];
  const storeKey = `asistente:v1:${userId}`;
  const [open,    setOpen]    = useState(false);
  const [msgs,    setMsgs]    = useState<Msg[]>([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [parcial, setParcial] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [avisos,  setAvisos]  = useState<Array<{ texto: string; pregunta: string }>>([]);
  const cargado = useRef(false);
  const endRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, loading, open, parcial]);
  useEffect(() => {
    setMsgs(loadStored(storeKey));
    cargado.current = true;
    if (rol !== "admin") {
      fetch("/api/asistente/avisos").then(r => r.json()).then(d => setAvisos(d.avisos ?? [])).catch(() => {});
    }
  }, [storeKey, rol]);
  useEffect(() => { if (cargado.current) saveStored(storeKey, msgs); }, [msgs, storeKey]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const next: Msg[] = [...msgs, { id: crypto.randomUUID(), role: "user", text: clean }];
    setMsgs(next);
    setInput("");
    setLoading(true);
    // Onboarding: primer uso del asistente (alumno/profe). No bloquea.
    if (rol === "student" || rol === "teacher") {
      fetch("/api/student/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "asistente" }) }).catch(() => {});
    }
    try {
      const res = await fetch("/api/asistente", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          messages: next.slice(-30).map(m => ({ role: m.role, content: historyContent(m).slice(0, 6000) })),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: data.message ?? t.errRespuesta }]);
        return;
      }
      // Streaming: una línea JSON por evento (ver /api/asistente).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", acumulado = "", terminado = false;
      const onEvent = (ev: { type: string; delta?: string; reply?: string; acciones?: Accion[]; message?: string }) => {
        if (ev.type === "text") { acumulado += ev.delta ?? ""; setParcial(acumulado); setBuscando(false); }
        else if (ev.type === "reset") { acumulado = ""; setParcial(""); }
        else if (ev.type === "tool") setBuscando(true);
        else if (ev.type === "done" || ev.type === "error") {
          terminado = true;
          const acciones: AccionUI[] = (ev.acciones ?? []).map(a => ({ ...a, estado: "pendiente" as const }));
          setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: ev.reply ?? ev.message ?? t.errRespuesta, acciones }]);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      }
      if (!terminado) setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: acumulado || t.errRespuesta }]);
    } catch {
      setMsgs(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: t.errConexion }]);
    } finally {
      setLoading(false);
      setParcial("");
      setBuscando(false);
    }
  };

  const patchAccion = (msgId: string, accionId: string, patch: Partial<AccionUI>) =>
    setMsgs(ms => ms.map(m => m.id !== msgId ? m : {
      ...m, acciones: m.acciones?.map(a => a.id === accionId ? { ...a, ...patch } : a),
    }));

  const confirmar = async (msgId: string, a: AccionUI) => {
    if (a.estado !== "pendiente" && a.estado !== "error") return;
    if (!a.request.url.startsWith("/api/")) return;
    patchAccion(msgId, a.id, { estado: "ejecutando", error: undefined });
    try {
      const res = await fetch(a.request.url, {
        method:  a.request.method,
        headers: a.request.body ? { "Content-Type": "application/json" } : undefined,
        body:    a.request.body ? JSON.stringify(a.request.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchAccion(msgId, a.id, { estado: "error", error: data?.message ?? t.errAccion });
        return;
      }
      patchAccion(msgId, a.id, { estado: "hecha" });
      router.refresh();
    } catch {
      patchAccion(msgId, a.id, { estado: "error", error: t.errConexion });
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed z-40 right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] lg:bottom-6 lg:right-6
            inline-flex items-center gap-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white
            px-4 py-3 text-sm font-semibold shadow-lg shadow-brand-500/30 transition-colors"
          aria-label="Abrir asistente"
          data-tour="asistente"
        >
          <span aria-hidden>✨</span> Asistente
          {avisos.length > 0 && msgs.length === 0 && (
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" aria-label={`${avisos.length} avisos`} />
          )}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Asistente"
          className="fixed z-50 inset-0 lg:inset-auto lg:right-6 lg:bottom-6 lg:w-[400px] lg:h-[600px] lg:max-h-[calc(100vh-3rem)]
            flex flex-col bg-white dark:bg-slate-900 lg:rounded-2xl lg:border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        >
          <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <span aria-hidden>✨</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">Asistente</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.sub}</p>
            </div>
            {msgs.length > 0 && (
              <button
                type="button"
                onClick={() => setMsgs([])}
                className="text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
              >
                {t.nueva}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 w-8 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Cerrar asistente"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50 dark:bg-slate-950">
            {msgs.length === 0 && (
              <div className="px-1 py-2">
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {t.hola}{nombre ? `, ${nombre}` : ""}. {t.intro}
                </p>
                {avisos.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {avisos.map(a => (
                      <button
                        key={a.texto}
                        type="button"
                        onClick={() => send(a.pregunta)}
                        className="text-left text-sm rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10
                          px-3 py-2 text-amber-900 dark:text-amber-200 hover:border-amber-400 transition-colors"
                      >
                        {a.texto}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2">
                  {SUGERENCIAS[lang][rol].map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => s.endsWith("…") ? (setInput(s.slice(0, -1)), inputRef.current?.focus()) : send(s)}
                      className="text-left text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900
                        px-3 py-2 text-slate-700 dark:text-slate-200 hover:border-brand-400 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map(m => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
                {m.text && (
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words
                      ${m.role === "user"
                        ? "bg-brand-500 text-white rounded-br-md"
                        : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-md"}`}
                  >
                    <RichText text={m.text} />
                  </div>
                )}
                {m.acciones?.map(a => (
                  <div
                    key={a.id}
                    className={`w-full max-w-[92%] rounded-2xl border px-3 py-3 bg-white dark:bg-slate-900
                      ${a.tipo === "cancelar" ? "border-rose-300 dark:border-rose-500/40" : "border-brand-300 dark:border-brand-500/40"}`}
                  >
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-50">{a.titulo}</div>
                    <ul className="mt-1 space-y-0.5">
                      {a.lineas.map((l, i) => (
                        <li key={i} className="text-sm text-slate-700 dark:text-slate-200">{l}</li>
                      ))}
                    </ul>
                    {a.nota && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{a.nota}</p>}

                    {a.estado === "hecha" && (
                      <p className="mt-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ {a.hecho ?? t[a.tipo]}</p>
                    )}
                    {a.estado === "descartada" && (
                      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t.descartada}</p>
                    )}
                    {a.estado === "error" && (
                      <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{a.error}</p>
                    )}
                    {(a.estado === "pendiente" || a.estado === "ejecutando" || a.estado === "error") && (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={a.estado === "ejecutando"}
                          onClick={() => confirmar(m.id, a)}
                          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-60
                            ${a.tipo === "cancelar" ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-500 hover:bg-brand-600"}`}
                        >
                          {a.estado === "ejecutando" ? t.momento : a.estado === "error" ? t.reintentar : t.confirmar}
                        </button>
                        <button
                          type="button"
                          disabled={a.estado === "ejecutando"}
                          onClick={() => patchAccion(m.id, a.id, { estado: "descartada" })}
                          className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                        >
                          {t.descartar}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <div className={`max-w-[88%] rounded-2xl rounded-bl-md px-3 py-2 text-sm whitespace-pre-wrap break-words bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800
                  ${parcial ? "text-slate-800 dark:text-slate-100" : "text-slate-500"}`}>
                  {parcial ? <RichText text={parcial} /> : buscando ? t.consultando : t.pensando}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={e => { e.preventDefault(); send(input); }}
            className="flex items-end gap-2 px-3 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900
              pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:pb-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              rows={1}
              maxLength={2000}
              placeholder={t.escribe}
              className="flex-1 resize-none max-h-32 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950
                px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
            >
              {t.enviar}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
