"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { VIDEO_CHECKLIST_ITEMS } from "@/lib/video-checklist";

type Recording = {
  id: string;
  status: "processing" | "ready" | "failed";
  file_url: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  created_at: string;
};

type VideoSession = {
  id: string;
  title: string;
  status: string;
  scheduled_at: string;
  created_at: string;
  recordings: Recording[];
};

export default function VideosPage() {
  const [sessions, setSessions] = useState<VideoSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, string>>({});
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const fetchChecklist = useCallback(async () => {
    try {
      const res = await fetch("/api/teacher/videos/checklist");
      const data = await res.json();
      if (data.ok) setCheckedItems(data.completed);
    } catch { /* ignore */ }
  }, []);

  const toggleCheck = async (key: string) => {
    if (togglingKey) return;
    setTogglingKey(key);
    try {
      const res = await fetch("/api/teacher/videos/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (data.ok) {
        setCheckedItems(prev => {
          const next = { ...prev };
          if (data.checked) next[key] = new Date().toISOString();
          else delete next[key];
          return next;
        });
      }
    } finally {
      setTogglingKey(null);
    }
  };

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/teacher/videos");
      const data = await res.json();
      if (data.ok) setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); fetchChecklist(); }, [fetchSessions, fetchChecklist]);

  const createSession = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/teacher/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = `/aula/${data.id}`;
      }
    } finally {
      setCreating(false);
    }
  };

  const downloadRecording = async (recId: string) => {
    setDownloading(recId);
    try {
      const res = await fetch(`/api/teacher/videos/${recId}/download`);
      const data = await res.json();
      if (data.ok && data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.download = "";
        a.click();
      }
    } finally {
      setDownloading(null);
    }
  };

  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const fmtSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <main className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
            ← Volver al inicio
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
            🎬 Estudio de grabación
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Graba contenido para YouTube. Entras solo al aula, grabas y descargas el video.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Nueva grabación
        </button>
      </header>

      {/* ── Checklist mensual ── */}
      {(() => {
        const done = VIDEO_CHECKLIST_ITEMS.filter(i => checkedItems[i.key]).length;
        const total = VIDEO_CHECKLIST_ITEMS.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                Videos por grabar este mes
              </h2>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {done}/{total} completados
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-4">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>

            <ul className="space-y-1">
              {VIDEO_CHECKLIST_ITEMS.map((item, idx) => {
                const checked = Boolean(checkedItems[item.key]);
                const toggling = togglingKey === item.key;
                return (
                  <li
                    key={item.key}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      checked
                        ? "bg-emerald-50 dark:bg-emerald-500/10"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCheck(item.key)}
                      disabled={toggling}
                      className={`shrink-0 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                        checked
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "border-slate-300 dark:border-slate-600 hover:border-emerald-400"
                      } ${toggling ? "opacity-50" : ""}`}
                      aria-label={checked ? `Desmarcar ${item.title}` : `Marcar ${item.title}`}
                    >
                      {checked && (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>

                    <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-5 text-center shrink-0">
                      {idx + 1}
                    </span>

                    {item.gammaUrl ? (
                      <a
                        href={item.gammaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-sm font-medium transition-colors ${
                          checked
                            ? "text-emerald-700 dark:text-emerald-300 line-through decoration-emerald-400/50"
                            : "text-slate-800 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400"
                        }`}
                      >
                        {item.title}
                        <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">↗</span>
                      </a>
                    ) : (
                      <span className={`text-sm font-medium ${
                        checked
                          ? "text-emerald-700 dark:text-emerald-300 line-through decoration-emerald-400/50"
                          : "text-slate-500 dark:text-slate-400"
                      }`}>
                        {item.title}
                        <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500 italic">
                          (enlace pendiente)
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {done === total && total > 0 && (
              <div className="mt-3 rounded-xl bg-emerald-100 dark:bg-emerald-500/15 px-4 py-2 text-center">
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  🎉 ¡Todos los videos del mes completados!
                </span>
              </div>
            )}
          </section>
        );
      })()}

      {/* ── Formulario nueva sesión ── */}
      {showForm && (
        <div className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-5">
          <h2 className="text-sm font-semibold text-brand-900 dark:text-brand-200">
            Nueva sesión de grabación
          </h2>
          <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
            Escribe un título para el video. Al crear, entrarás directamente al aula para grabar.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ej: A1 – Verben im Präsens"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400"
              onKeyDown={e => e.key === "Enter" && createSession()}
            />
            <button
              type="button"
              onClick={createSession}
              disabled={!title.trim() || creating}
              className="shrink-0 rounded-xl bg-brand-600 hover:bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {creating ? "Creando…" : "Crear y entrar"}
            </button>
          </div>
        </div>
      )}

      {/* ── Lista de sesiones ── */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 dark:text-slate-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="mt-2 text-sm">Cargando videos…</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
          <span className="text-4xl" aria-hidden>🎥</span>
          <h2 className="mt-3 text-lg font-semibold text-slate-700 dark:text-slate-200">
            Aún no hay videos
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Crea tu primera sesión de grabación para empezar.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => {
            const readyRecs = s.recordings.filter(r => r.status === "ready");
            const processingRecs = s.recordings.filter(r => r.status === "processing");
            const hasReady = readyRecs.length > 0;
            const isProcessing = processingRecs.length > 0;

            return (
              <div
                key={s.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-50 truncate">
                      {s.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {fmtDate(s.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {s.status === "scheduled" && (
                      <Link
                        href={`/aula/${s.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 hover:bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                        Entrar al estudio
                      </Link>
                    )}
                    {s.status === "live" && (
                      <Link
                        href={`/aula/${s.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 hover:bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                        En vivo — Entrar
                      </Link>
                    )}
                  </div>
                </div>

                {/* Recordings */}
                {(hasReady || isProcessing) && (
                  <div className="mt-3 space-y-2">
                    {readyRecs.map(r => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 text-sm">
                          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          <span className="text-emerald-800 dark:text-emerald-200 font-medium">
                            {r.duration_seconds ? fmtDuration(r.duration_seconds) : "—"}
                          </span>
                          {r.file_size_bytes && (
                            <span className="text-emerald-600 dark:text-emerald-400 text-xs">
                              · {fmtSize(r.file_size_bytes)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadRecording(r.id)}
                          disabled={downloading === r.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          {downloading === r.id ? "Descargando…" : "Descargar MP4"}
                        </button>
                      </div>
                    ))}

                    {processingRecs.map(r => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-3 py-2 text-sm"
                      >
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                        <span className="text-amber-800 dark:text-amber-200 font-medium">
                          Procesando grabación…
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!hasReady && !isProcessing && s.status === "completed" && (
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    Sesión finalizada sin grabación.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
