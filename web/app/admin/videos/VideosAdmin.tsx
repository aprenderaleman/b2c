"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Ep = {
  id: string; number: number; slug: string; title_de: string; title_es: string; level: string; duration_s: number | null;
  video_url: string | null; poster_url: string | null; published: boolean; avg_stars: number | null; ratings_count: number; comments_count: number;
};
type RecentComment = { id: string; body: string; created_at: string; student_name: string; episode_number: number; episode_slug: string };

/**
 * /admin/videos — subida directa navegador → R2 con URL firmada de PUT
 * (sin pasar por Vercel: body máx. 4,5 MB). Para cada episodio: elegir el
 * MP4 y/o el JPG, PUT con progreso, y PATCH para guardar las URLs.
 */
export function VideosAdmin({ episodes, recent }: { episodes: Ep[]; recent: RecentComment[] }) {
  const router = useRouter();
  const [prog, setProg] = useState<Record<string, string>>({});
  const [err, setErr]   = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const put = (url: string, file: File, contentType: string, onP: (pct: number) => void) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = ev => { if (ev.lengthComputable) onP(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`R2 respondió ${xhr.status}`));
    xhr.onerror = () => reject(new Error("No se pudo conectar con R2 (¿CORS del bucket sin PUT desde este dominio?)"));
    xhr.send(file);
  });

  const upload = async (ep: Ep, kind: "video" | "poster", file: File) => {
    const k = `${ep.slug}:${kind}`;
    setBusy(b => ({ ...b, [k]: true })); setErr(e => ({ ...e, [k]: "" })); setProg(p => ({ ...p, [k]: "Preparando…" }));
    try {
      const r1 = await fetch("/api/admin/serie/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: ep.slug, kind }) });
      const d1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !d1.uploadUrl) throw new Error(d1.message ?? d1.error ?? "No se pudo firmar la subida");
      await put(d1.uploadUrl, file, d1.contentType, pct => setProg(p => ({ ...p, [k]: `Subiendo ${pct}%` })));
      const r2 = await fetch(`/api/admin/serie/${ep.slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "video" ? { video_url: d1.fileUrl } : { poster_url: d1.fileUrl }) });
      if (!r2.ok) throw new Error("Subido, pero no se pudo guardar la URL");
      setProg(p => ({ ...p, [k]: "Listo ✓" }));
      router.refresh();
    } catch (e) {
      setErr(x => ({ ...x, [k]: e instanceof Error ? e.message : "Error" })); setProg(p => ({ ...p, [k]: "" }));
    } finally { setBusy(b => ({ ...b, [k]: false })); }
  };

  const togglePublished = async (ep: Ep) => {
    await fetch(`/api/admin/serie/${ep.slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ published: !ep.published }) });
    router.refresh();
  };
  const hide = async (id: string) => {
    if (!confirm("¿Ocultar este comentario?")) return;
    await fetch(`/api/admin/serie/comments/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const Picker = ({ ep, kind }: { ep: Ep; kind: "video" | "poster" }) => {
    const k = `${ep.slug}:${kind}`; const has = kind === "video" ? !!ep.video_url : !!ep.poster_url;
    return (
      <div className="min-w-[180px]">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${has ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"} ${busy[k] ? "opacity-60" : ""}`}>
          <input type="file" accept={kind === "video" ? "video/mp4" : "image/jpeg"} className="hidden" disabled={busy[k]}
                 onChange={e => { const f = e.target.files?.[0]; if (f) void upload(ep, kind, f); e.currentTarget.value = ""; }} />
          {kind === "video" ? "🎬" : "🖼️"} {has ? (kind === "video" ? "Vídeo subido · reemplazar" : "Portada subida · reemplazar") : (kind === "video" ? "Elegir MP4" : "Elegir JPG")}
        </label>
        {prog[k] && <div className="mt-1 text-[11px] text-slate-500">{prog[k]}</div>}
        {err[k] && <div className="mt-1 text-[11px] text-red-600">{err[k]}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Cap.</th><th className="px-4 py-3">Título</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Vídeo</th><th className="px-4 py-3">Portada</th><th className="px-4 py-3">Valoración</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {episodes.map(ep => (
              <tr key={ep.id} className="align-top">
                <td className="px-4 py-3 font-mono text-slate-500">{ep.number}</td>
                <td className="px-4 py-3"><div className="font-semibold text-slate-900 dark:text-slate-50">{ep.title_de}</div><div className="text-xs text-slate-500">{ep.title_es} · {ep.level}{ep.duration_s ? ` · ${Math.round(ep.duration_s / 60)} min` : ""}</div></td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ep.video_url && ep.poster_url ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"}`}>
                    {ep.video_url && ep.poster_url ? "subido" : ep.video_url ? "sin portada" : "sin vídeo"}
                  </span>
                  {!ep.published && <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[11px]">oculto</span>}
                </td>
                <td className="px-4 py-3"><Picker ep={ep} kind="video" /></td>
                <td className="px-4 py-3"><Picker ep={ep} kind="poster" /></td>
                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{ep.ratings_count > 0 ? `★ ${ep.avg_stars} (${ep.ratings_count})` : "—"}<div className="text-slate-400">{ep.comments_count} coment.</div></td>
                <td className="px-4 py-3"><button type="button" onClick={() => togglePublished(ep)} className="text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">{ep.published ? "Ocultar" : "Publicar"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Comentarios recientes</h2>
        {recent.length === 0 ? <p className="mt-2 text-sm text-slate-400">Aún no hay comentarios.</p> : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map(c => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500"><span className="font-semibold text-slate-700 dark:text-slate-200">{c.student_name}</span> · Kapitel {c.episode_number} · {new Date(c.created_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{c.body}</p>
                </div>
                <button type="button" onClick={() => hide(c.id)} className="shrink-0 text-xs text-red-600 hover:underline">Ocultar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
