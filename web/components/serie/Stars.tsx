"use client";

import { useState } from "react";

/** Estrellas de solo lectura (media) o interactivas (valoración propia). */
export function Stars({ value, size = "md", onRate, disabled }: { value: number; size?: "sm" | "md" | "lg"; onRate?: (n: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const cls = size === "sm" ? "text-sm" : size === "lg" ? "text-3xl" : "text-xl";
  return (
    <span className={`inline-flex items-center gap-0.5 ${cls}`} role={onRate ? "radiogroup" : undefined} aria-label={onRate ? "Tu valoración" : `${value} de 5`}>
      {[1, 2, 3, 4, 5].map(n => {
        const filled = shown >= n - 0.25;
        const half = !filled && shown >= n - 0.75;
        const star = <span className={filled ? "text-amber-400" : half ? "text-amber-300" : "text-slate-300 dark:text-slate-600"}>{filled || half ? "★" : "☆"}</span>;
        return onRate
          ? <button key={n} type="button" disabled={disabled} onClick={() => onRate(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}
                    className="transition-transform hover:scale-110 disabled:opacity-60" aria-label={`${n} estrella${n === 1 ? "" : "s"}`}>{star}</button>
          : <span key={n}>{star}</span>;
      })}
    </span>
  );
}
