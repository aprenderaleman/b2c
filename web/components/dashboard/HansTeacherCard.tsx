/**
 * Card promocional de Hans en el dashboard del profesor.
 *
 * Vive en `/profesor` (arriba del fold, antes de NextClassCard) y solo
 * se renderiza cuando el usuario tiene un perfil de teacher (la página
 * ya hace el guard server-side, así que aquí confiamos en la
 * ubicación). Hans es la app paralela de tutor IA en
 * https://hans.aprender-aleman.de — los profesores entran con
 * magic-link usando su mismo email del B2C y Hans los reconoce vía
 * `/api/internal/hans/teachers`.
 *
 * Diseño: card clara con eyebrow naranja, título navy, botón navy y
 * badge "10 días gratis" en la esquina superior derecha. Se inspira
 * en `OpenSchuleTeacherButton` y los demás CTAs del dashboard pero
 * con jerarquía mayor (es nueva).
 */

const HANS_URL = "https://hans.aprender-aleman.de";

export function HansTeacherCard() {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700
                 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm"
    >
      {/* Badge esquina superior derecha — "10 días gratis" */}
      <div
        className="absolute top-3 right-3 sm:top-4 sm:right-4
                   inline-flex items-center gap-1 px-2.5 py-1
                   rounded-full bg-warm/15 text-[#B4651F]
                   text-[11px] font-bold uppercase tracking-wider
                   border border-warm/30"
      >
        🎁 10 días gratis
      </div>

      {/* Eyebrow naranja */}
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-warm">
        Nuevo · Para profesores
      </div>

      {/* Título */}
      <h2 className="mt-2 text-[20px] sm:text-2xl font-bold tracking-tight
                     text-slate-900 dark:text-slate-50 pr-24 sm:pr-28">
        Hans — tu asistente IA para preparar clases
      </h2>

      {/* Texto */}
      <p className="mt-2 text-sm sm:text-[15px] text-slate-600 dark:text-slate-300
                    leading-relaxed">
        Ejercicios, planes de clase, diálogos con audio y worksheets en segundos.
        10 días gratis, sin tarjeta.
      </p>

      {/* Botón Navy */}
      <div className="mt-5">
        <a
          href={HANS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 h-11
                     rounded-2xl bg-[#0F2847] hover:bg-[#0F2847]/90
                     text-white font-semibold text-sm
                     shadow-sm active:scale-[0.98] transition"
        >
          Abrir Hans
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </a>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Inicia sesión con tu mismo email del B2C — Hans te reconoce automáticamente.
        </p>
      </div>
    </section>
  );
}
