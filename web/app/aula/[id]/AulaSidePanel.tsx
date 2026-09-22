"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Panel lateral del aula con dos pestañas (petición Sabine 2026-09-22:
 * "todo en uno, sin ventana extra"):
 *
 *   - Chat:  el chat PERSISTENTE de la plataforma (tabla messages), no el
 *            efímero de LiveKit. Lo que se escribe/adjunta aquí queda para
 *            siempre en la pestaña Mensajes de profe y estudiante, y admite
 *            PDFs/archivos vía /api/chat/upload.
 *   - Notas: las notas del profe de ESTA clase (classes.teacher_notes),
 *            con autoguardado. Solo visible para el host.
 *
 * El componente queda SIEMPRE montado (oculto por CSS) para que el polling
 * siga corriendo y el badge de no leídos del TopBar sea fiable.
 *
 * En clases de prueba y sesiones-plan el aula sigue usando el ChatPanel
 * efímero de LiveKit (el lead no tiene cuenta → no puede usar el chat
 * persistente).
 */

type Message = {
  id:           string;
  author_id:    string;
  author_name:  string | null;
  author_email: string;
  content:      string;
  attachments:  Array<{ url: string; name: string; size?: number; content_type?: string }>;
  sent_at:      string;
  deleted:      boolean;
};

export function AulaSidePanel({
  open, onClose, chatId, classId, showNotes, currentUserId, onUnreadChange,
}: {
  open:           boolean;
  onClose:        () => void;
  chatId:         string | null;
  classId:        string;
  showNotes:      boolean;
  currentUserId:  string;
  onUnreadChange: (n: number) => void;
}) {
  const [tab, setTab] = useState<"chat" | "notas">(chatId ? "chat" : "notas");
  const chatVisible = open && tab === "chat";

  return (
    <aside
      className={`absolute right-0 top-0 bottom-0 z-20 w-80 max-w-[85vw]
                  border-l border-slate-800 bg-slate-950/90 backdrop-blur-sm
                  shadow-2xl flex flex-col ${open ? "" : "hidden"}`}
      aria-hidden={!open}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-1">
          {chatId && (
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>Chat</TabButton>
          )}
          {showNotes && (
            <TabButton active={tab === "notas"} onClick={() => setTab("notas")}>Notas</TabButton>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xl leading-none px-1"
          aria-label="Cerrar panel"
        >×</button>
      </header>

      {chatId && (
        <div className={`flex-1 min-h-0 flex-col ${tab === "chat" ? "flex" : "hidden"}`}>
          <PersistentChat
            chatId={chatId}
            currentUserId={currentUserId}
            visible={chatVisible}
            onUnreadChange={onUnreadChange}
          />
        </div>
      )}
      {showNotes && tab === "notas" && (
        <NotesTab classId={classId} />
      )}
    </aside>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors
        ${active ? "bg-brand-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// Chat persistente — versión de una sola conversación del ChatShell,
// con estilos oscuros de aula. Polling cada 5s SIEMPRE (aunque el
// panel esté cerrado) para alimentar el badge de no leídos.
// ───────────────────────────────────────────────────────────────────
function PersistentChat({ chatId, currentUserId, visible, onUnreadChange }: {
  chatId:         string;
  currentUserId:  string;
  visible:        boolean;
  onUnreadChange: (n: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [seenOthers, setSeenOthers] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/chat/${chatId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch { /* offline / transitorio */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // No leídos = mensajes de otros por encima de la marca "visto". La
  // marca arranca en el primer load (nada previo cuenta como no leído)
  // y se actualiza cada vez que el panel está visible.
  const othersCount = messages.filter(m => m.author_id !== currentUserId && !m.deleted).length;
  useEffect(() => {
    if (seenOthers === null && !loading) {
      setSeenOthers(othersCount);
      return;
    }
    if (visible && seenOthers !== null && othersCount !== seenOthers) {
      setSeenOthers(othersCount);
      fetch(`/api/chat/${chatId}/read`, { method: "POST" }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, othersCount, loading]);

  useEffect(() => {
    onUnreadChange(visible || seenOthers === null ? 0 : Math.max(0, othersCount - seenOthers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, othersCount, seenOthers]);

  // Al abrir, marcar leído y bajar al final.
  useEffect(() => {
    if (!visible) return;
    fetch(`/api/chat/${chatId}/read`, { method: "POST" }).catch(() => null);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && visible) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  return (
    <>
      <p className="px-3 pt-2 text-[10px] text-slate-500 shrink-0">
        Este chat se guarda — lo verás también en «Mensajes» después de clase.
      </p>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {loading && <p className="text-xs text-slate-500">Cargando mensajes…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-8">Aún no hay mensajes. Envía el primero 👋</p>
        )}
        {messages.map(m => (
          <Bubble key={m.id} message={m} mine={m.author_id === currentUserId} />
        ))}
      </div>
      <Composer chatId={chatId} onSent={() => void load()} />
    </>
  );
}

function Bubble({ message, mine }: { message: Message; mine: boolean }) {
  if (message.deleted) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <span className="text-[11px] italic text-slate-500 px-2 py-1">(Mensaje eliminado)</span>
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        {!mine && (
          <div className="text-[10px] font-semibold text-slate-400 mb-0.5 px-2">
            {message.author_name ?? message.author_email}
          </div>
        )}
        <div className={`inline-block px-3 py-1.5 rounded-2xl text-sm whitespace-pre-wrap break-words
          ${mine ? "bg-brand-500 text-white" : "bg-slate-800 text-slate-100 border border-slate-700"}`}
        >
          {message.content}
          {message.attachments.length > 0 && (
            <div className={`mt-1.5 space-y-1 text-xs ${mine ? "text-white/90" : "text-slate-300"}`}>
              {message.attachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block underline underline-offset-2 hover:opacity-80"
                >
                  📎 {a.name}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className={`text-[10px] text-slate-500 mt-0.5 px-1 ${mine ? "text-right" : ""}`}>
          {new Date(message.sent_at).toLocaleTimeString("es-ES", {
            hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
          })}
        </div>
      </div>
    </div>
  );
}

function Composer({ chatId, onSent }: { chatId: string; onSent: () => void }) {
  const [text,      setText]      = useState("");
  const [attaching, setAttaching] = useState(false);
  const [sending,   setSending]   = useState(false);
  const [pending,   setPending]   = useState<Array<{
    url: string; name: string; size: number; content_type: string;
  }>>([]);

  const uploadFiles = async (files: FileList) => {
    setAttaching(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/chat/upload", { method: "POST", body: form });
        if (!res.ok) continue;
        const data = await res.json();
        setPending(prev => [...prev, {
          url: data.url, name: data.name, size: data.size, content_type: data.content_type,
        }]);
      }
    } finally { setAttaching(false); }
  };

  const send = async () => {
    const t = text.trim();
    if ((!t && pending.length === 0) || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chat/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: t, attachments: pending }),
      });
      if (res.ok) {
        setText("");
        setPending([]);
        onSent();
      }
    } finally { setSending(false); }
  };

  return (
    <div className="px-2 py-2 border-t border-slate-800 shrink-0">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pending.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              📎 {p.name}
              <button
                type="button"
                onClick={() => setPending(pending.filter((_, idx) => idx !== i))}
                className="text-slate-500 hover:text-red-400"
                aria-label={`Quitar ${p.name}`}
              >✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <label className="inline-flex items-center justify-center h-9 w-9 shrink-0 cursor-pointer rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700" title="Adjuntar archivo (PDF, imagen…)">
          <span aria-hidden>📎</span>
          <input
            type="file"
            className="hidden"
            multiple
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = "";
            }}
            disabled={attaching}
          />
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={attaching ? "Subiendo…" : "Escribe un mensaje…"}
          rows={1}
          autoComplete="off"
          autoCorrect="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-28"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || attaching || (!text.trim() && pending.length === 0)}
          className="shrink-0 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
        >
          {sending ? "…" : "➤"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Notas de la clase — classes.teacher_notes con autoguardado (1.5s tras
// dejar de teclear), igual que las notas de clases de prueba.
// ───────────────────────────────────────────────────────────────────
function NotesTab({ classId }: { classId: string }) {
  const [notes,   setNotes]   = useState("");
  const [shared,  setShared]  = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [state,   setState]   = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teacher/classes/${classId}/notes`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setNotes(data.teacher_notes ?? "");
        setShared(Boolean(data.notes_shared_with_student));
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  const save = async (nextNotes: string, nextShared: boolean) => {
    setState("saving");
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacher_notes: nextNotes || null, shared_with_student: nextShared }),
      });
      setState(res.ok ? "saved" : "error");
    } catch { setState("error"); }
  };

  const scheduleSave = (nextNotes: string, nextShared: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(nextNotes, nextShared), 1_500);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
      <p className="text-[10px] text-slate-500 shrink-0">
        Tus notas de esta clase — se guardan solas y las verás luego en la ficha de la clase.
      </p>
      <textarea
        value={notes}
        maxLength={2000}
        disabled={!loaded}
        onChange={(e) => {
          setNotes(e.target.value);
          setState("idle");
          scheduleSave(e.target.value, shared);
        }}
        placeholder={loaded ? "Apuntes de la clase…" : "Cargando…"}
        className="flex-1 min-h-0 w-full resize-none rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />
      <div className="flex items-center justify-between gap-2 shrink-0">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => {
              setShared(e.target.checked);
              scheduleSave(notes, e.target.checked);
            }}
            className="rounded border-slate-600 bg-slate-800 text-brand-500 focus:ring-brand-500"
          />
          Visible para el alumno
        </label>
        <span className={`text-[11px] ${
          state === "error" ? "text-red-400" :
          state === "saving" ? "text-slate-400" :
          state === "saved" ? "text-emerald-400" : "text-transparent"}`}
        >
          {state === "error" ? "Error al guardar — reintenta" :
           state === "saving" ? "Guardando…" :
           state === "saved" ? "Guardado ✓" : "·"}
        </span>
      </div>
    </div>
  );
}
