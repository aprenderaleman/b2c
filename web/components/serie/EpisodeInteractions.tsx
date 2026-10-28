"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Stars } from "./Stars";
import type { Comment } from "@/lib/serie";

/** Valoración 1–5 (se guarda al instante) + comentarios del capítulo. */
export function EpisodeInteractions({ slug, myStars, initialComments, canInteract }: { slug: string; myStars: number | null; initialComments: Comment[]; canInteract: boolean }) {
  const router = useRouter();
  const [stars, setStars] = useState<number | null>(myStars);
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rate = async (n: number) => {
    if (!canInteract) return;
    setStars(n); setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/estudiante/serie/${slug}/rating`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stars: n }) });
      if (!res.ok) setErr("No se pudo guardar tu valoración.");
      else router.refresh();
    } finally { setSaving(false); }
  };

  const send = async () => {
    const clean = body.trim();
    if (!clean || !canInteract) return;
    setSending(true); setErr(null);
    try {
      const res = await fetch(`/api/estudiante/serie/${slug}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: clean }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.comment) { setErr(d.message ?? "No se pudo publicar el comentario."); return; }
      setComments(c => [...c, d.comment as Comment]); setBody("");
    } finally { setSending(false); }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" });

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Tu valoración</h2>
        <div className="mt-2 flex items-center gap-3">
          <Stars value={stars ?? 0} size="lg" onRate={canInteract ? rate : undefined} disabled={saving || !canInteract} />
          <span className="text-sm text-slate-500 dark:text-slate-400">{stars ? `${stars} de 5` : canInteract ? "Toca una estrella" : "Solo los alumnos pueden valorar"}</span>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Comentarios ({comments.length})</h2>
        <ul className="mt-3 space-y-3">
          {comments.length === 0 && <li className="text-sm text-slate-400">Aún no hay comentarios. ¿Qué te ha parecido el capítulo?</li>}
          {comments.map(c => (
            <li key={c.id} className="rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{c.student_name}{c.mine ? " (tú)" : ""}</span>
                <span>{fmt(c.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{c.body}</p>
            </li>
          ))}
        </ul>
        {canInteract && (
          <div className="mt-4">
            <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 1000))} rows={3} placeholder="Escribe tu comentario (máx. 1000 caracteres)…"
                      className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">{body.length}/1000</span>
              <button type="button" onClick={send} disabled={sending || !body.trim()} className="btn-primary text-sm disabled:opacity-60">{sending ? "Publicando…" : "Publicar"}</button>
            </div>
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
    </section>
  );
}
