"use client";

import { useSearchParams } from "next/navigation";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

type ChatListItem = {
  id:                   string;
  type:                 "direct" | "group";
  title:                string;
  last_message_at:      string | null;
  last_message_preview: string | null;
  unread_count:         number;
  other_user_ids?:      string[];
};

type Colleague = {
  user_id: string;
  name:    string;
  chat_id: string | null;
};

type Message = {
  id:           string;
  chat_id:      string;
  author_id:    string;
  author_name:  string | null;
  author_email: string;
  content:      string;
  attachments:  Array<{ url: string; name: string; size?: number; content_type?: string }>;
  sent_at:      string;
  deleted:      boolean;
};

type Props = {
  currentUserId:   string;
  currentUserName: string;
  /**
   * true cuando se renderiza dentro de un panel de rol (/profesor/chats,
   * /estudiante/chats): altura contenida + borde redondeado en vez de
   * ocupar el viewport completo.
   */
  embedded?: boolean;
};

/**
 * Two-panel chat UI. Left: conversations list, sorted by last_message_at.
 * Right: active conversation with message list + composer. Polls the
 * active chat every 4s for new messages (we'll swap to Supabase Realtime
 * once we expose the anon key to the browser — for now polling is simpler
 * and avoids a bigger security review).
 */
/** Lee ?chat=<id> de la URL y lo selecciona (abrir conversación desde contactos). */
function UrlChatSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const sp = useSearchParams();
  const wanted = sp?.get("chat") ?? null;
  useEffect(() => { if (wanted) onSelect(wanted); }, [wanted, onSelect]);
  return null;
}

export function ChatShell({ currentUserId, currentUserName: _currentUserName, embedded = false }: Props) {
  const [chats,       setChats]       = useState<ChatListItem[]>([]);
  const [colleagues,  setColleagues]  = useState<Colleague[]>([]);
  const [activeId,    setActiveId]    = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<"students" | "colleagues">("students");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = await res.json();
      setChats(data.chats ?? []);
      if (data.colleagues?.length) setColleagues(data.colleagues);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const selectFromUrl = useCallback((id: string) => { setActiveId(id); void load(); }, [load]);

  const hasColleagues = colleagues.length > 0;
  const colleagueUserIds = new Set(colleagues.map(c => c.user_id));

  const studentChats = hasColleagues
    ? chats.filter(c => !(c.other_user_ids ?? []).some(uid => colleagueUserIds.has(uid)))
    : chats;
  const colleagueChats = hasColleagues
    ? chats.filter(c => (c.other_user_ids ?? []).some(uid => colleagueUserIds.has(uid)))
    : [];

  const visibleChats = tab === "colleagues" ? colleagueChats : studentChats;
  const active = chats.find(c => c.id === activeId) ?? null;

  const startColleagueChat = async (colleagueUserId: string) => {
    try {
      const res = await fetch("/api/chat/start-colleague", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colleague_user_id: colleagueUserId }),
      });
      const data = await res.json();
      if (data.chat_id) {
        setTab("colleagues");
        setActiveId(data.chat_id);
        void load();
      }
    } catch { /* ignore */ }
  };

  return (
    // Móvil: UN panel a la vez (lista O conversación, con botón ← volver).
    // Antes se apilaban ambos dentro de la altura fija con overflow-hidden
    // y el historial quedaba cortado sin poder hacer scroll (reporte
    // Gelfis 2026-10-11).
    <main className={`grid grid-cols-1 md:grid-cols-[320px_1fr] bg-slate-50 dark:bg-slate-950
      ${embedded
        ? "h-[calc(100vh-10rem)] min-h-[420px] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        : "h-[calc(100vh-3.5rem)]"}`}>
      <Suspense fallback={null}><UrlChatSelector onSelect={selectFromUrl} /></Suspense>
      {/* Conversations list */}
      <aside className={`border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto min-h-0
        ${activeId ? "hidden md:block" : ""}`}>
        <header className="px-4 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          {hasColleagues ? (
            <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setTab("students")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors
                  ${tab === "students"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
              >
                Estudiantes
              </button>
              <button
                type="button"
                onClick={() => setTab("colleagues")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors
                  ${tab === "colleagues"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
              >
                Colegas
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Conversaciones</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {chats.length} {chats.length === 1 ? "conversación" : "conversaciones"}
              </p>
            </>
          )}
        </header>

        {tab === "colleagues" && hasColleagues && (
          <ul>
            {colleagues.map(col => {
              const existingChat = colleagueChats.find(c =>
                (c.other_user_ids ?? []).includes(col.user_id)
              );
              return (
                <li key={col.user_id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (existingChat) {
                        setActiveId(existingChat.id);
                      } else {
                        void startColleagueChat(col.user_id);
                      }
                    }}
                    className={`block w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors
                      ${activeId && existingChat?.id === activeId
                        ? "bg-brand-50 dark:bg-brand-500/10"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                        {col.name}
                      </span>
                      {existingChat ? (
                        existingChat.unread_count > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">
                            {existingChat.unread_count}
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-400">Nuevo</span>
                      )}
                    </div>
                    {existingChat?.last_message_preview && (
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {existingChat.last_message_preview}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {tab === "students" && (
          <ul>
            {loading && <li className="p-4 text-sm text-slate-500">Cargando…</li>}
            {!loading && visibleChats.length === 0 && (
              <li className="p-6 text-sm text-slate-500 dark:text-slate-400">
                Cuando te asignen una clase, se abrirá automáticamente un chat con tu profesor o grupo.
              </li>
            )}
            {visibleChats.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={`block w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors
                    ${activeId === c.id
                      ? "bg-brand-50 dark:bg-brand-500/10"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                          {c.title}
                        </span>
                        {c.type === "group" && (
                          <span className="text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-400">Grupo</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {c.last_message_preview ?? <em className="italic">Sin mensajes aún</em>}
                      </div>
                    </div>
                    {c.unread_count > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Active conversation */}
      <section className={`flex-col min-w-0 min-h-0 ${active ? "flex" : "hidden md:flex"}`}>
        {active ? (
          <ActiveChat
            key={active.id}
            chat={active}
            currentUserId={currentUserId}
            onChange={(updatedChats) => setChats(updatedChats)}
            chats={chats}
            onBack={() => setActiveId(null)}
          />
        ) : (
          <EmptyActive />
        )}
      </section>
    </main>
  );
}

function EmptyActive() {
  return (
    <div className="flex-1 flex items-center justify-center text-center px-6">
      <div>
        <div className="text-5xl" aria-hidden>💬</div>
        <p className="mt-3 text-slate-500 dark:text-slate-400 text-sm">
          Selecciona una conversación para ver los mensajes.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline"
        >
          ← Volver
        </Link>
      </div>
    </div>
  );
}

function ActiveChat({ chat, currentUserId, chats, onChange, onBack }: {
  chat:          ChatListItem;
  currentUserId: string;
  chats:         ChatListItem[];
  onChange:      (c: ChatListItem[]) => void;
  onBack:        () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll SOLO si el usuario está abajo (o en la carga inicial).
  // Antes, cada mensaje nuevo del polling te arrastraba al final aunque
  // estuvieras leyendo el historial arriba.
  const nearBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/chat/${chat.id}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // Mark read on open.
    fetch(`/api/chat/${chat.id}/read`, { method: "POST" }).then(() => {
      // Zero the unread badge locally.
      onChange(chats.map(c => c.id === chat.id ? { ...c, unread_count: 0 } : c));
    }).catch(() => null);

    // Poll for new messages every 4s while this chat is active.
    const t = setInterval(load, 4_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Auto-scroll to bottom on new messages — pero respetando al lector:
  // si está repasando el historial (lejos del final), no lo movemos.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (!didInitialScrollRef.current || nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScrollRef.current = true;
    }
  }, [messages.length]);

  // Legacy plain-text sender kept for backward compat; now unused — Composer
  // handles sending via its own internal fetch.
  const _unusedSend = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      const res = await fetch(`/api/chat/${chat.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: t }),
      });
      if (res.ok) {
        await load();
      }
    } catch { /* ignore */ }
  };
  void _unusedSend;   // keep reference so the type-checker doesn't complain

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-3 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden shrink-0 rounded-lg p-1.5 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
          aria-label="Volver a conversaciones"
        >
          ←
        </button>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50 truncate">{chat.title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {chat.type === "group" ? "Chat de grupo" : "Conversación directa"}
          </p>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-2 bg-slate-50 dark:bg-slate-950">
        {loading && <p className="text-sm text-slate-500">Cargando mensajes…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
            Aún no hay mensajes. Envía el primero 👋
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.author_id === currentUserId}
            showAuthor={chat.type === "group" && (i === 0 || messages[i - 1].author_id !== m.author_id)}
          />
        ))}
      </div>

      <Composer chatId={chat.id} onSent={() => void load()} />
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

  // ── Cuadro de texto que crece con el contenido (hasta ~10 líneas) ──
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  // ── Corrector gramatical es/de automático (LanguageTool vía /api/chat/grammar) ──
  type GMatch = { offset: number; length: number; message: string; short: string; replacement: string | null; rule: string; category: string };
  const [gram, setGram] = useState<{ language: string | null; matches: GMatch[]; checkedText: string } | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 3) { setGram(null); return; }
    const h = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/chat/grammar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        const data = await res.json() as { language: string | null; matches: GMatch[] };
        setGram({ language: data.language, matches: data.matches ?? [], checkedText: text });
      } catch { /* sin corrector: no bloquea el envío */ }
      finally { setChecking(false); }
    }, 1200);
    return () => clearTimeout(h);
  }, [text]);

  const applyMatches = (which: GMatch[]) => {
    if (!gram || gram.checkedText !== text) return;
    // Aplicar de atrás hacia delante para que los offsets sigan válidos.
    let out = text;
    for (const m of [...which].filter(m => m.replacement != null).sort((a, b) => b.offset - a.offset)) {
      out = out.slice(0, m.offset) + m.replacement + out.slice(m.offset + m.length);
    }
    setText(out);
    setGram(null);
  };
  const fixable = (gram?.matches ?? []).filter(m => m.replacement != null);
  const gramVisible = gram && gram.checkedText === text && gram.matches.length > 0;

  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Subida directa del navegador a Storage (sin pasar por Vercel, que
  // corta a 4,5 MB): URL firmada → PUT con progreso → registro.
  const putWithProgress = (url: string, file: File, onProgress: (pct: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`storage ${xhr.status}: ${xhr.responseText.slice(0, 120)}`));
      xhr.onerror = () => reject(new Error("red: no se pudo conectar con el almacenamiento"));
      xhr.send(file);
    });

  const uploadFiles = async (files: FileList) => {
    setAttaching(true);
    setUploadError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const label = files.length > 1 ? `${f.name} (${i + 1}/${files.length})` : f.name;
        setUploadInfo(`Preparando ${label}…`);
        const start = await fetch("/api/chat/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.name, type: f.type || "application/octet-stream", size: f.size }),
        });
        const sd = await start.json().catch(() => ({}));
        if (!start.ok || !sd.signedUrl) { setUploadError(sd.message ?? `No se pudo preparar la subida de ${f.name}.`); continue; }
        try {
          await putWithProgress(sd.signedUrl, f, (pct) => setUploadInfo(`Subiendo ${label}… ${pct}%`));
        } catch (e) {
          setUploadError(`Error subiendo ${f.name}: ${e instanceof Error ? e.message : "desconocido"}`);
          continue;
        }
        const done = await fetch("/api/chat/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: sd.path, name: sd.name, type: f.type || "application/octet-stream", size: f.size }),
        });
        const dd = await done.json().catch(() => ({}));
        if (!done.ok || !dd.url) { setUploadError(`Subido pero no se pudo registrar ${f.name}.`); continue; }
        setPending(prev => [...prev, { url: dd.url, name: dd.name, size: dd.size, content_type: dd.content_type }]);
      }
    } finally { setAttaching(false); setUploadInfo(null); }
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
    <div className="px-3 sm:px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300"
            >
              📎 {p.name}
              <button
                type="button"
                onClick={() => setPending(pending.filter((_, idx) => idx !== i))}
                className="text-slate-400 hover:text-red-500"
                aria-label={`Quitar ${p.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="inline-flex items-center justify-center h-10 w-10 shrink-0 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
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
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={attaching ? (uploadInfo ?? "Subiendo…") : "Escribe un mensaje… (Shift+Enter: salto de línea)"}
          rows={1}
          spellCheck
          lang={gram?.language?.startsWith("de") ? "de" : "es"}
          className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm leading-relaxed text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-60 overflow-y-auto"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || attaching || (!text.trim() && pending.length === 0)}
          className="btn-primary text-sm shrink-0"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
      {uploadError && (
        <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} className="shrink-0 underline">cerrar</button>
        </div>
      )}
      {(gramVisible || checking) && (
        <div className="mt-2 text-xs">
          {checking && !gramVisible && <span className="text-slate-400">Revisando ortografía y gramática…</span>}
          {gramVisible && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  {gram!.matches.length} sugerencia{gram!.matches.length === 1 ? "" : "s"} ({gram!.language?.startsWith("de") ? "alemán" : "español"})
                </span>
                {fixable.length > 0 && (
                  <button type="button" onClick={() => applyMatches(fixable)} className="rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700">
                    Corregir todo ({fixable.length})
                  </button>
                )}
              </div>
              <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                {gram!.matches.slice(0, 8).map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-amber-900/90 dark:text-amber-200/90">
                    <span className="truncate">
                      <span className="line-through opacity-70">{text.slice(m.offset, m.offset + m.length)}</span>
                      {m.replacement != null && <> → <strong>{m.replacement}</strong></>}
                      <span className="opacity-70"> · {m.short || m.message}</span>
                    </span>
                    {m.replacement != null && (
                      <button type="button" onClick={() => applyMatches([m])} className="shrink-0 text-[11px] underline hover:no-underline">Aplicar</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, mine, showAuthor }: {
  message: Message; mine: boolean; showAuthor: boolean;
}) {
  if (message.deleted) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <span className="text-xs italic text-slate-400 dark:text-slate-500 px-3 py-1.5">
          (Mensaje eliminado)
        </span>
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      {/* La burbuja se alinea a la derecha, pero el TEXTO siempre va a la
          izquierda: con text-right las líneas largas se apilaban contra el
          borde y costaba leerlas (Gelfis 2026-10-13). Solo la hora queda a
          la derecha. */}
      <div className={`max-w-[80%] ${mine ? "flex flex-col items-end" : ""}`}>
        {showAuthor && !mine && (
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 px-3">
            {message.author_name ?? message.author_email}
          </div>
        )}
        <div className={`inline-block px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words text-left
          ${mine
            ? "bg-brand-500 text-white"
            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"}`}
        >
          <Linkify text={message.content} mine={mine} />
          {message.attachments.length > 0 && (
            <div className={`mt-2 space-y-1 text-xs ${mine ? "text-white/90" : "text-slate-600 dark:text-slate-300"}`}>
              {/* Siempre vía /api/chat/attachment (re-firma al vuelo) — las
                  URLs guardadas caducan a los 7 días (caso Sabine 2026-10-27). */}
              {message.attachments.map((a, i) => {
                const fresh = `/api/chat/attachment?m=${message.id}&i=${i}`;
                if ((a.content_type ?? "").startsWith("video/")) {
                  return <video key={`m${i}`} src={fresh} controls preload="metadata" className="mt-1 max-h-72 w-full max-w-sm rounded-lg bg-black" />;
                }
                if ((a.content_type ?? "").startsWith("image/")) {
                  return <a key={`m${i}`} href={fresh} target="_blank" rel="noopener noreferrer"><img src={fresh} alt={a.name} className="mt-1 max-h-72 max-w-sm rounded-lg object-contain" /></a>;
                }
                return null;
              })}
              {message.attachments.map((a, i) => (
                <a
                  key={i}
                  href={`/api/chat/attachment?m=${message.id}&i=${i}`}
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
        <div className={`text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 px-1 ${mine ? "text-right" : ""}`}>
          {formatTime(message.sent_at)}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Convierte URLs y correos del texto en enlaces clicables (Gelfis
 * 2026-10-13: los enlaces salían como texto plano). Abre en pestaña nueva
 * con rel seguro; el resto del texto se mantiene tal cual.
 */
const LINK_RE = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]|[\w.+-]+@[\w-]+\.[\w.-]+)/gi;
function Linkify({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(LINK_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const isMail = part.includes("@") && !/^(https?:\/\/|www\.)/i.test(part);
        const href = isMail ? `mailto:${part}` : part.startsWith("www.") ? `https://${part}` : part;
        return (
          <a
            key={i}
            href={href}
            target={isMail ? undefined : "_blank"}
            rel="noopener noreferrer"
            className={`underline underline-offset-2 break-all ${mine ? "text-white hover:text-white/80" : "text-brand-600 dark:text-brand-400 hover:opacity-80"}`}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}
