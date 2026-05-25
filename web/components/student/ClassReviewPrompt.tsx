"use client";

import { useEffect, useState } from "react";

type Props = {
  classId:     string;
  teacherName: string;
  groupName:   string | null;
  scheduledAt: string;        // ISO
};

/**
 * Tarjeta no intrusiva (esquina inferior derecha) que aparece tras
 * 2.5s en /estudiante cuando el alumno tiene una clase reciente sin
 * reseñar. Stars 1-5 + comentario opcional + botón "Ahora no".
 *
 * Diseño:
 *  - Slide-in suave desde la derecha
 *  - No bloquea el dashboard (sin overlay)
 *  - "Ahora no" inserta dismissed_at → no vuelve a aparecer para esa clase
 */
export function ClassReviewPrompt({ classId, teacherName, groupName, scheduledAt }: Props) {
  const [visible, setVisible] = useState(false);
  const [rating,  setRating]  = useState<number | null>(null);
  const [hover,   setHover]   = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState(false);

  useEffect(() => {
    // Delay para no atacar nada más cargar — el dashboard debe sentirse
    // primero. 2.5s es suficiente para que el alumno se ubique.
    const t = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const submit = async (payload: { dismissed?: true; rating?: number; comment?: string }) => {
    setBusy(true);
    try {
      await fetch("/api/student/reviews", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ class_id: classId, ...payload }),
      });
      if (payload.dismissed) {
        setVisible(false);
      } else {
        setDone(true);
        setTimeout(() => setVisible(false), 1800);
      }
    } catch {
      // Silencioso — el alumno verá el prompt otra vez la próxima carga.
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = new Date(scheduledAt).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long", day: "2-digit", month: "long",
  });

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 space-y-3 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      {done ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 text-center py-2">
          ¡Gracias por tu reseña! 💚
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                ¿Cómo fue tu clase con {teacherName}?
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {groupName ? `${groupName} · ` : ""}{dateLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => submit({ dismissed: true })}
              disabled={busy}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none px-1"
              aria-label="Cerrar"
              title="Ahora no"
            >
              ×
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5 py-1" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map(n => {
              const filled = (hover ?? rating ?? 0) >= n;
              return (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  disabled={busy}
                  className="text-3xl leading-none transition-transform hover:scale-110"
                  aria-label={`${n} estrella${n === 1 ? "" : "s"}`}
                >
                  <span className={filled ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}>★</span>
                </button>
              );
            })}
          </div>

          {rating !== null && (
            <>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={rating <= 3 ? "¿Qué podemos mejorar? (opcional)" : "¿Qué te gustó? (opcional)"}
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => submit({ dismissed: true })}
                  disabled={busy}
                  className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1"
                >
                  Ahora no
                </button>
                <button
                  type="button"
                  onClick={() => submit({ rating, comment: comment.trim() || undefined })}
                  disabled={busy}
                  className="text-xs font-semibold rounded-full bg-brand-500 hover:bg-brand-600 text-white px-4 py-1.5 disabled:opacity-50"
                >
                  {busy ? "Enviando…" : "Enviar reseña"}
                </button>
              </div>
            </>
          )}

          {rating === null && (
            <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
              Toca una estrella para empezar
            </p>
          )}
        </>
      )}
    </div>
  );
}
