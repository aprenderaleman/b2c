"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RESOURCE_KINDS, RESOURCE_LEVELS,
  type ResourceKind, type ResourceLevel, type TeacherResource,
} from "@/lib/teacher-resources";

type Filters = {
  level: ResourceLevel | null;
  kind:  ResourceKind  | null;
  q:     string;
};

/**
 * Cliente para /estudiante/biblioteca. Lista de tarjetas con filtros.
 * Click "Abrir" → API /api/profesor/recursos/{id}/open → window.open.
 *
 * Para vídeos de YouTube/Vimeo intentamos detectar el ID y embebir,
 * pero por simplicidad ahora abrimos el enlace en nueva pestaña.
 */
export function StudentLibraryClient({
  initialResources, currentLevel, showAll, initialFilters,
}: {
  initialResources: TeacherResource[];
  currentLevel:     string;
  showAll:          boolean;
  initialFilters:   Filters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<Filters>(initialFilters);

  function applyFilters(next: Filters, opts?: { all?: boolean }) {
    setFilters(next);
    const p = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.level) p.set("level", next.level); else p.delete("level");
    if (next.kind)  p.set("kind", next.kind);   else p.delete("kind");
    if (next.q)     p.set("q", next.q);          else p.delete("q");
    if (opts?.all === true) p.set("all", "1");
    if (opts?.all === false) p.delete("all");
    startTransition(() => {
      router.replace(`/estudiante/biblioteca${p.toString() ? "?" + p.toString() : ""}`);
      router.refresh();
    });
  }

  async function openResource(id: string) {
    const r = await fetch(`/api/profesor/recursos/${id}/open`);
    const j = await r.json();
    if (!r.ok || !j.url) {
      alert(j.message ?? j.error ?? "No se pudo abrir el recurso");
      return;
    }
    window.open(j.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
        <input
          type="search"
          value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
          onKeyDown={e => { if (e.key === "Enter") applyFilters(filters); }}
          placeholder="Buscar…"
          className="input-text w-full"
        />

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">Nivel:</span>
          {/* Default smart: "Mi nivel" (su current + below) */}
          <button
            type="button"
            onClick={() => applyFilters({ ...filters, level: null }, { all: false })}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              !filters.level && !showAll
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            Mi nivel ({currentLevel})
          </button>
          <button
            type="button"
            onClick={() => applyFilters({ ...filters, level: null }, { all: true })}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              !filters.level && showAll
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            Todos
          </button>
          {RESOURCE_LEVELS.filter(l => l.id !== "XX").map(l => {
            const isActive = filters.level === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => applyFilters({ ...filters, level: l.id })}
                className={`px-2.5 py-1 text-xs rounded-full border transition ${
                  isActive
                    ? "bg-brand-600 border-brand-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">Tipo:</span>
          <button
            type="button"
            onClick={() => applyFilters({ ...filters, kind: null })}
            className={`px-2.5 py-1 text-xs rounded-full border transition ${
              !filters.kind
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            Todos
          </button>
          {RESOURCE_KINDS.map(k => {
            const isActive = filters.kind === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => applyFilters({ ...filters, kind: k.id })}
                className={`px-2.5 py-1 text-xs rounded-full border transition ${
                  isActive
                    ? "bg-brand-600 border-brand-600 text-white"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                }`}
              >
                <span className="mr-1" aria-hidden>{k.emoji}</span>{k.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => applyFilters(filters)}
            disabled={pending}
            className="btn-secondary text-xs ml-auto"
          >
            Aplicar
          </button>
        </div>
      </section>

      {initialResources.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
          <div className="text-4xl">📚</div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Aún no hay recursos en tu biblioteca para este filtro. Tus profesores irán añadiendo vídeos y enlaces aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(() => {
            // Cuaderno = recurso de ejercicios (PDF o Word, ambos son cuadernos).
            // Lección = recurso de estudio teórico (presentación, apuntes…).
            // Distinguimos por `topic` porque kind solo dice el formato.
            const isCuaderno = (r: TeacherResource) =>
              (r.topic || "").toLowerCase().includes("cuaderno");
            const cuadernos = initialResources.filter(r =>
              (r.kind === "doc" || r.kind === "pdf") && isCuaderno(r)
            );
            const lecciones = initialResources.filter(r =>
              (r.kind === "doc" || r.kind === "pdf") && !isCuaderno(r)
            );
            const videos    = initialResources.filter(r => r.kind === "video_link");
            const enlaces   = initialResources.filter(r => r.kind === "source_link");
            return (
              <>
                {lecciones.length > 0 && (
                  <StudentSection title="📄 Lecciones" items={lecciones} accent="blue" onOpen={openResource} />
                )}
                {cuadernos.length > 0 && (
                  <StudentSection title="📝 Cuadernos de ejercicios" items={cuadernos} accent="emerald" onOpen={openResource} />
                )}
                {videos.length > 0 && (
                  <StudentSection title="🎬 Vídeos" items={videos} accent="amber" onOpen={openResource} />
                )}
                {enlaces.length > 0 && (
                  <StudentSection title="🔗 Enlaces" items={enlaces} accent="slate" onOpen={openResource} />
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function StudentSection({ title, items, accent, onOpen }: {
  title: string;
  items: TeacherResource[];
  accent: "blue" | "emerald" | "amber" | "slate";
  onOpen: (id: string) => void;
}) {
  const accentCls =
    accent === "blue"    ? "text-blue-700 dark:text-blue-300" :
    accent === "emerald" ? "text-emerald-700 dark:text-emerald-300" :
    accent === "amber"   ? "text-amber-700 dark:text-amber-300" :
                            "text-slate-700 dark:text-slate-300";
  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <h2 className={`text-sm font-bold tracking-tight ${accentCls}`}>{title}</h2>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
          {items.length}
        </span>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(r => (
          <StudentResourceCard key={r.id} r={r} onOpen={() => onOpen(r.id)} />
        ))}
      </ul>
    </section>
  );
}

function StudentResourceCard({ r, onOpen }: {
  r: TeacherResource;
  onOpen: () => void;
}) {
  const kindMeta = RESOURCE_KINDS.find(k => k.id === r.kind);
  // Para vídeos: intentar extraer un thumbnail de YouTube
  const youtubeThumb = r.kind === "video_link" && r.external_url
    ? youtubeThumbnail(r.external_url)
    : null;

  return (
    <li className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-brand-400 transition">
      {youtubeThumb ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full aspect-video bg-slate-100 dark:bg-slate-800 overflow-hidden relative group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubeThumb}
            alt={r.title}
            className="w-full h-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="h-14 w-14 rounded-full bg-black/60 text-white flex items-center justify-center text-2xl">▶</span>
          </span>
        </button>
      ) : (
        <div className="flex items-center justify-center aspect-video bg-slate-100 dark:bg-slate-800 text-5xl">
          {kindMeta?.emoji ?? "📎"}
        </div>
      )}
      <div className="p-4 flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">{r.title}</h3>
        {r.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{r.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5 items-center text-[10px] mt-1">
          <span className={`px-2 py-0.5 rounded-full font-semibold ${
            r.level === "XX"
              ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              : "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300"
          }`}>{r.level === "XX" ? "Todos los niveles" : r.level}</span>
          {/* Badge de formato — distingue PDF (se abre en navegador) de Word (descarga) */}
          {r.kind === "pdf" && (
            <span className="px-2 py-0.5 rounded-full font-semibold bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300">
              PDF
            </span>
          )}
          {r.kind === "doc" && (
            <span className="px-2 py-0.5 rounded-full font-semibold bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300">
              Word
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {r.topic}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {r.uploader_name ? `De ${r.uploader_name.split(/\s+/)[0]}` : "Aprender-Aleman.de"}
          </span>
          <button type="button" onClick={onOpen} className="btn-primary text-xs px-3 py-1.5 shrink-0">
            Abrir →
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Saca el thumbnail HD de un vídeo de YouTube a partir de su URL.
 * Soporta youtube.com/watch?v=ID, youtu.be/ID y shorts.
 */
function youtubeThumbnail(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname.includes("youtube.com")) {
      id = u.searchParams.get("v");
      if (!id) {
        // /shorts/ID
        const m = u.pathname.match(/\/shorts\/([^/?]+)/);
        if (m) id = m[1];
      }
    } else if (u.hostname === "youtu.be") {
      id = u.pathname.replace(/^\//, "").split("/")[0] || null;
    }
    if (!id) return null;
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } catch {
    return null;
  }
}
