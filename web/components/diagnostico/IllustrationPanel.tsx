/**
 * Panel de ilustración para el funnel de diagnóstico.
 *
 * Diseño tipo Preply (Gelfis 2026-05-26):
 *   - Desktop: ocupa la mitad izquierda con la ilustración centrada en
 *     un fondo pastel suave (warm/peach tint del brand).
 *   - Mobile: se convierte en banda horizontal arriba del contenido,
 *     altura compacta (160-200px) con la ilustración a la izquierda.
 *
 * Cada paso del funnel recibe una ilustración distinta — son SVG
 * inline con paletas brand (warm + amber + cream).
 */
import { type ReactNode } from "react";

type StepKey =
  | "motivo"
  | "nivel"
  | "datos"
  | "calendario"
  | "low_budget"
  | "already_registered";

export function IllustrationPanel({
  step,
  children,
}: {
  step: StepKey;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row">
      {/* Panel izquierdo (desktop) / banda superior (mobile) con la
          ilustración + fondo pastel. */}
      <aside
        className="relative w-full md:w-1/2 md:min-h-[100dvh]
                   bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50
                   flex items-center justify-center
                   py-6 md:py-12
                   border-b md:border-b-0 md:border-r border-rose-100"
      >
        <div className="w-full max-w-xs md:max-w-md px-6">
          <IllustrationFor step={step} />
        </div>
      </aside>

      {/* Panel derecho — contenido del paso. Padding ya está dentro
          de cada step component. */}
      <section className="flex-1 md:w-1/2 flex flex-col bg-white">
        {children}
      </section>
    </div>
  );
}

function IllustrationFor({ step }: { step: StepKey }) {
  if (step === "motivo")        return <IllustrationMotivo />;
  if (step === "nivel")         return <IllustrationNivel />;
  if (step === "datos")         return <IllustrationDatos />;
  if (step === "calendario")    return <IllustrationCalendario />;
  if (step === "low_budget")    return <IllustrationLowBudget />;
  if (step === "already_registered") return <IllustrationAlreadyReg />;
  return null;
}

// ── Ilustraciones SVG ─────────────────────────────────────────────
// Estilo simple, flat, paleta brand (warm orange + amber + cream).
// Cada SVG es ~viewbox 280x280 para que escale bien en mobile/desktop.

function IllustrationMotivo() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Libro/cuaderno como base */}
      <ellipse cx="140" cy="220" rx="80" ry="10" fill="#0f172a" opacity="0.08" />
      <rect x="60" y="150" width="160" height="80" rx="6" fill="#fde68a" />
      <rect x="60" y="150" width="160" height="14" fill="#fbbf24" />
      <rect x="80" y="180" width="120" height="5" rx="2" fill="#f59e0b" opacity="0.4" />
      <rect x="80" y="195" width="90" height="5" rx="2" fill="#f59e0b" opacity="0.4" />
      <rect x="80" y="210" width="100" height="5" rx="2" fill="#f59e0b" opacity="0.4" />
      {/* Lápiz con emoji-style atrás */}
      <g transform="rotate(-25 110 130)">
        <rect x="60" y="50" width="20" height="100" rx="3" fill="#f97316" />
        <polygon points="60,150 80,150 70,170" fill="#1e293b" />
        <rect x="60" y="50" width="20" height="20" fill="#fbbf24" />
      </g>
      {/* Bombilla/idea arriba a la derecha */}
      <g transform="translate(170 50)">
        <circle cx="20" cy="20" r="22" fill="#fde68a" stroke="#f59e0b" strokeWidth="3" />
        <rect x="14" y="40" width="12" height="8" rx="2" fill="#94a3b8" />
        <path d="M14 25 L16 22 M20 14 V18 M26 22 L24 25" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function IllustrationNivel() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Gráfico de barras creciente — la mejor metáfora visual para "nivel" */}
      <ellipse cx="140" cy="240" rx="100" ry="8" fill="#0f172a" opacity="0.08" />
      <line x1="50" y1="70" x2="50" y2="230" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" />
      <line x1="50" y1="230" x2="230" y2="230" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" />
      {/* Barras crecientes */}
      <rect x="68"  y="190" width="28" height="40"  rx="3" fill="#fed7aa" />
      <rect x="104" y="160" width="28" height="70"  rx="3" fill="#fdba74" />
      <rect x="140" y="125" width="28" height="105" rx="3" fill="#fb923c" />
      <rect x="176" y="85"  width="28" height="145" rx="3" fill="#f97316" />
      {/* Estrella en la cima */}
      <g transform="translate(190 65)">
        <polygon points="0,-12 3,-4 12,-3 5,3 7,12 0,7 -7,12 -5,3 -12,-3 -3,-4" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

function IllustrationDatos() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Móvil con burbuja de WhatsApp */}
      <ellipse cx="140" cy="240" rx="80" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Teléfono */}
      <rect x="95" y="55" width="90" height="170" rx="14" fill="#1e293b" />
      <rect x="103" y="68" width="74" height="140" rx="4" fill="#fff7ed" />
      <circle cx="140" cy="217" r="4" fill="#475569" />
      {/* Burbuja WhatsApp encima */}
      <g transform="translate(165 30)">
        <circle cx="30" cy="30" r="30" fill="#25D366" />
        <path d="M30 14c-9 0-16 7-16 16 0 3 1 6 2 8l-2 8 8-2c2 1 5 2 8 2 9 0 16-7 16-16s-7-16-16-16z" fill="white" />
        <path d="M24 22c-1 0-2 1-2 2 0 5 5 11 11 11 1 0 2 0 2-1l1-2c0-1 0-1-1-1l-2-1c-1 0-1 0-2 1l-1 1c-2-1-3-2-4-4l1-1c1-1 1-1 1-2l-1-2c0-1 0-1-1-1h-2z" fill="#25D366" />
      </g>
      {/* Líneas de mensaje */}
      <rect x="115" y="90"  width="50" height="6" rx="3" fill="#fed7aa" />
      <rect x="115" y="105" width="40" height="6" rx="3" fill="#fed7aa" />
      <rect x="115" y="130" width="46" height="6" rx="3" fill="#fdba74" />
      <rect x="115" y="145" width="35" height="6" rx="3" fill="#fdba74" />
    </svg>
  );
}

function IllustrationCalendario() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="80" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Calendar base */}
      <rect x="60" y="70" width="160" height="150" rx="10" fill="#fff7ed" stroke="#f97316" strokeWidth="3" />
      <rect x="60" y="70" width="160" height="30" rx="10" fill="#f97316" />
      <rect x="60" y="90" width="160" height="10" fill="#f97316" />
      {/* Anillas */}
      <rect x="85" y="55" width="8" height="25" rx="2" fill="#1e293b" />
      <rect x="187" y="55" width="8" height="25" rx="2" fill="#1e293b" />
      {/* Días (puntos en grid) */}
      {[0,1,2,3,4].map(c => [0,1,2].map(r => (
        <circle key={`${c}-${r}`} cx={85 + c*28} cy={125 + r*28} r="6" fill="#fed7aa" />
      )))}
      {/* Día seleccionado — con check */}
      <circle cx="141" cy="153" r="14" fill="#f97316" />
      <path d="M134 153 L139 158 L148 148" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function IllustrationLowBudget() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="70" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Hucha / moneda */}
      <circle cx="140" cy="140" r="70" fill="#fde68a" stroke="#f59e0b" strokeWidth="4" />
      <text x="140" y="155" fontSize="56" textAnchor="middle" fill="#92400e" fontWeight="700">€</text>
    </svg>
  );
}

function IllustrationAlreadyReg() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="80" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Candado abierto verde */}
      <rect x="90" y="135" width="100" height="80" rx="10" fill="#34d399" />
      <path d="M110 135 V100 c0-17 14-30 30-30 12 0 22 7 27 17"
            stroke="#10b981" strokeWidth="10" fill="none" strokeLinecap="round" />
      <circle cx="140" cy="175" r="10" fill="white" />
      <rect x="138" y="175" width="4" height="14" fill="white" />
    </svg>
  );
}
