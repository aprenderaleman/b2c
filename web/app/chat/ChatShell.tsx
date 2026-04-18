"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type ChatListItem = {
  id:                   string;
  type:                 "direct" | "group";
  title:                string;
  last_message_at:      string | null;
  last_message_preview: string | null;
  unread_count:         number;
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
};

/**
 * Two-panel chat UI. Left: conversations list, sorted by last_message_at.
 * Right: active conversation with message list + composer. Polls the
 * active chat every 4s for new messages (we'll swap to Supabase Realtime
 * once we expose the anon key to the browser — for now polling is simpler
 * and avoids a bigger security review).
 */
export function ChatShell({ currentUserId, currentUserName: _currentUserName }: Props) {
  const [chats,    setChats]    = useState<ChatListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/chat");
        const data = await res.json();
        setChats(data.chats ?? []);
      } catch { /* offline */ }
      finally { setLoading(false); }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const active = chats.find(c => c.id === activeId) ?? null;

  return (
    <main className="h-[calc(100vh-3.5rem)] grid grid-cols-1 md:grid-cols-[320px_1fr] bg-slate-50 dark:bg-slate-950">
      {/* Conversations list */}
      <aside className="border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto">
        <header className="px-4 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-50">Conversaciones</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {chats.length} {chats.length === 1 ? "conversación" : "conversaciones"}
          </p>
        </header>
        <ul>
          {loading && <li className="p-4 text-sm text-slate-500">Cargando…</li>}
          {!loading && chats.length === 0 && (
            <li className="p-6 text-sm text-slate-500 dark:text-slate-400">
              Cuando te asignen una clase, se abrirá automáticamente un chat con tu profesor o grupo.
            </li>
          )}
          {chats.map(c => (
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
      </aside>

      {/* Active conversation */}
      <section className="flex flex-col min-w-0">
        {active ? (
          <ActiveChat
            key={active.id}
            chat={active}
            currentUserId={currentUserId}
            onChange={(updatedChats) => setChats(updatedChats)}
            chats={chats}
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

function ActiveChat({ chat, currentUserId, chats, onChange }: {
  chat:          ChatListItem;
  currentUserId: string;
  chats:         ChatListItem[];
  onChange:      (c: ChatListItem[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
      <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">{chat.title}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {chat.type === "group" ? "Chat de grupo" : "Conversación directa"}
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-2 bg-slate-50 dark:bg-slate-950">
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
          className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-32"
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
      <div className={`max-w-[80%] ${mine ? "text-right" : ""}`}>
        {showAuthor && !mine && (
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 px-3">
            {message.author_name ?? message.author_email}
          </div>
        )}
        <div className={`inline-block px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words
          ${mine
            ? "bg-brand-500 text-white"
            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700"}`}
        >
          {message.content}
          {message.attachments.length > 0 && (
            <div className={`mt-2 space-y-1 text-xs ${mine ? "text-white/90" : "text-slate-600 dark:text-slate-300"}`}>
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
