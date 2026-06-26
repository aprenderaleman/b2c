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

export type StepKey =
  | "motivo"
  | "nivel"
  | "datos"
  | "calendario"
  | "formulario"
  | "low_budget"
  | "already_registered"
  | "success"
  | "particulares";

export function IllustrationPanel({
  step,
  children,
}: {
  step: StepKey;
  children: ReactNode;
}) {
  return (
    // Wrapper sin min-h-[100dvh] propio — la altura la determina el
    // contenedor padre (DiagnosticoFunnel u otra página) que monta el
    // header full-width arriba. Antes este wrapper forzaba 100dvh y
    // tras meter el header full-width se desbordaba la pantalla.
    <div className="w-full flex flex-col md:flex-row flex-1">
      {/* Panel izquierdo (desktop) / banda superior (mobile) con la
          ilustración + fondo pastel. */}
      <aside
        className="relative w-full md:w-1/2
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
  if (step === "formulario")    return <IllustrationFormulario />;
  if (step === "low_budget")    return <IllustrationLowBudget />;
  if (step === "already_registered") return <IllustrationAlreadyReg />;
  if (step === "success")       return <IllustrationSuccess />;
  if (step === "particulares")  return <IllustrationParticulares />;
  return null;
}

// ── Ilustraciones SVG ─────────────────────────────────────────────
// Estilo simple, flat, paleta brand (warm orange + amber + cream).
// Cada SVG es ~viewbox 280x280 para que escale bien en mobile/desktop.

function IllustrationMotivo() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Libro/cuaderno como base — fade in */}
      <ellipse cx="140" cy="220" rx="80" ry="10" fill="#0f172a" opacity="0.08" />
      <g className="illo-anim" style={{ animation: "illoDropIn 480ms ease-out both" }}>
        <rect x="60" y="150" width="160" height="80" rx="6" fill="#fde68a" />
        <rect x="60" y="150" width="160" height="14" fill="#fbbf24" />
      </g>
      {/* Líneas del cuaderno — cascada */}
      <rect x="80" y="180" width="120" height="5" rx="2" fill="#f59e0b" opacity="0.4" style={{ animation: "illoFadeIn 300ms 500ms ease-out both" }} />
      <rect x="80" y="195" width="90" height="5" rx="2" fill="#f59e0b" opacity="0.4" style={{ animation: "illoFadeIn 300ms 620ms ease-out both" }} />
      <rect x="80" y="210" width="100" height="5" rx="2" fill="#f59e0b" opacity="0.4" style={{ animation: "illoFadeIn 300ms 740ms ease-out both" }} />
      {/* Lápiz — slide in desde la izquierda */}
      <g transform="rotate(-25 110 130)" className="illo-anim" style={{ animation: "illoSlideInLeft 480ms 200ms cubic-bezier(.34,1.4,.64,1) both" }}>
        <rect x="60" y="50" width="20" height="100" rx="3" fill="#f97316" />
        <polygon points="60,150 80,150 70,170" fill="#1e293b" />
        <rect x="60" y="50" width="20" height="20" fill="#fbbf24" />
      </g>
      {/* Bombilla — pop + twinkle infinito (la idea brilla) */}
      <g transform="translate(170 50)" className="illo-anim" style={{ transformOrigin: "190px 70px", animation: "illoPopIn 420ms 900ms cubic-bezier(.34,1.56,.64,1) both, illoTwinkle 2.4s 1500ms ease-in-out infinite" }}>
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
      <line x1="50" y1="70" x2="50" y2="230" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" style={{ animation: "illoFadeIn 300ms ease-out both" }} />
      <line x1="50" y1="230" x2="230" y2="230" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" style={{ animation: "illoFadeIn 300ms ease-out both" }} />
      {/* Barras crecen desde el suelo en cascada */}
      <rect x="68"  y="190" width="28" height="40"  rx="3" fill="#fed7aa" className="illo-anim" style={{ transformOrigin: "82px 230px", animation: "illoGrowUp 380ms 250ms cubic-bezier(.34,1.4,.64,1) both" }} />
      <rect x="104" y="160" width="28" height="70"  rx="3" fill="#fdba74" className="illo-anim" style={{ transformOrigin: "118px 230px", animation: "illoGrowUp 420ms 380ms cubic-bezier(.34,1.4,.64,1) both" }} />
      <rect x="140" y="125" width="28" height="105" rx="3" fill="#fb923c" className="illo-anim" style={{ transformOrigin: "154px 230px", animation: "illoGrowUp 480ms 520ms cubic-bezier(.34,1.4,.64,1) both" }} />
      <rect x="176" y="85"  width="28" height="145" rx="3" fill="#f97316" className="illo-anim" style={{ transformOrigin: "190px 230px", animation: "illoGrowUp 540ms 680ms cubic-bezier(.34,1.4,.64,1) both" }} />
      {/* Estrella — pop + twinkle infinito */}
      <g transform="translate(190 65)" className="illo-anim" style={{ animation: "illoPopIn 420ms 1180ms cubic-bezier(.34,1.56,.64,1) both, illoTwinkle 2.6s 1700ms ease-in-out infinite" }}>
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
      {/* Teléfono — drop in */}
      <g className="illo-anim" style={{ animation: "illoDropIn 480ms ease-out both" }}>
        <rect x="95" y="55" width="90" height="170" rx="14" fill="#1e293b" />
        <rect x="103" y="68" width="74" height="140" rx="4" fill="#fff7ed" />
        <circle cx="140" cy="217" r="4" fill="#475569" />
      </g>
      {/* Burbuja WhatsApp — pop + float infinito */}
      <g transform="translate(165 30)" className="illo-anim" style={{ transformOrigin: "195px 60px", animation: "illoPopIn 420ms 600ms cubic-bezier(.34,1.56,.64,1) both, illoFloat 3s 1100ms ease-in-out infinite" }}>
        <circle cx="30" cy="30" r="30" fill="#25D366" />
        <path d="M30 14c-9 0-16 7-16 16 0 3 1 6 2 8l-2 8 8-2c2 1 5 2 8 2 9 0 16-7 16-16s-7-16-16-16z" fill="white" />
        <path d="M24 22c-1 0-2 1-2 2 0 5 5 11 11 11 1 0 2 0 2-1l1-2c0-1 0-1-1-1l-2-1c-1 0-1 0-2 1l-1 1c-2-1-3-2-4-4l1-1c1-1 1-1 1-2l-1-2c0-1 0-1-1-1h-2z" fill="#25D366" />
      </g>
      {/* Líneas de mensaje — cascada */}
      <rect x="115" y="90"  width="50" height="6" rx="3" fill="#fed7aa" style={{ animation: "illoFadeIn 280ms 800ms ease-out both" }} />
      <rect x="115" y="105" width="40" height="6" rx="3" fill="#fed7aa" style={{ animation: "illoFadeIn 280ms 920ms ease-out both" }} />
      <rect x="115" y="130" width="46" height="6" rx="3" fill="#fdba74" style={{ animation: "illoFadeIn 280ms 1040ms ease-out both" }} />
      <rect x="115" y="145" width="35" height="6" rx="3" fill="#fdba74" style={{ animation: "illoFadeIn 280ms 1160ms ease-out both" }} />
    </svg>
  );
}

function IllustrationCalendario() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="80" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Calendar base — drop in desde arriba */}
      <g className="illo-anim" style={{ animation: "illoDropIn 500ms ease-out both" }}>
        <rect x="60" y="70" width="160" height="150" rx="10" fill="#fff7ed" stroke="#f97316" strokeWidth="3" />
        <rect x="60" y="70" width="160" height="30" rx="10" fill="#f97316" />
        <rect x="60" y="90" width="160" height="10" fill="#f97316" />
        {/* Anillas */}
        <rect x="85" y="55" width="8" height="25" rx="2" fill="#1e293b" />
        <rect x="187" y="55" width="8" height="25" rx="2" fill="#1e293b" />
      </g>
      {/* Días (puntos en grid) — pop in en cascada */}
      {[0,1,2,3,4].map(c => [0,1,2].map(r => (
        <circle
          key={`${c}-${r}`} cx={85 + c*28} cy={125 + r*28} r="6" fill="#fed7aa"
          className="illo-anim"
          style={{ animation: `illoPopIn 280ms ${500 + (c*3 + r) * 40}ms cubic-bezier(.34,1.56,.64,1) both` }}
        />
      )))}
      {/* Día seleccionado — círculo pop + pulse loop */}
      <circle
        cx="141" cy="153" r="14" fill="#f97316"
        className="illo-anim"
        style={{
          transformOrigin: "141px 153px",
          animation: "illoPopIn 360ms 1100ms cubic-bezier(.34,1.56,.64,1) both, illoPulse 2.6s 1500ms ease-in-out infinite",
        }}
      />
      {/* Check — stroke draw + queda dibujado */}
      <path
        d="M134 153 L139 158 L148 148"
        stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"
        pathLength={100}
        style={{
          strokeDasharray: 100, strokeDashoffset: 100,
          animation: "illoStrokeDraw 380ms 1350ms ease-out both",
        }}
      />
    </svg>
  );
}

function IllustrationFormulario() {
  // Sobre con líneas + badge ✓ + bandera. Refuerza "te llegará el email
  // de confirmación, comprométete a venir". Paleta brand (warm+amber).
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="248" rx="92" ry="9" fill="#0f172a" opacity="0.08" />

      {/* Sobre — body cae desde arriba */}
      <g className="illo-anim" style={{ animation: "illoDropIn 500ms ease-out both" }}>
        <rect x="58" y="90" width="164" height="118" rx="10" fill="#fff7ed" stroke="#f97316" strokeWidth="3.5" />
        {/* Solapa abierta (triángulo invertido) */}
        <path d="M58 100 L140 165 L222 100" fill="none" stroke="#f97316" strokeWidth="3.5" strokeLinejoin="round" />
      </g>

      {/* Líneas tipo "asunto" — fade-in cascada */}
      <rect x="98"  y="120" width="84" height="4" rx="2" fill="#fbbf24" opacity="0.6" style={{ animation: "illoFadeIn 320ms 700ms ease-out both" }} />
      <rect x="110" y="132" width="60" height="4" rx="2" fill="#fbbf24" opacity="0.6" style={{ animation: "illoFadeIn 320ms 820ms ease-out both" }} />

      {/* Líneas internas — simulando contenido */}
      <rect x="78"  y="178" width="80" height="5" rx="2" fill="#fed7aa" style={{ animation: "illoFadeIn 320ms 940ms ease-out both" }} />
      <rect x="78"  y="190" width="56" height="5" rx="2" fill="#fed7aa" style={{ animation: "illoFadeIn 320ms 1060ms ease-out both" }} />

      {/* Badge ✓ verde — pop-in + pulse loop. Wrap doble: outer hace
          el pop, inner hace el pulse infinito sin pisarse. */}
      <g transform="translate(190 60)">
        <g className="illo-anim" style={{ transformOrigin: "22px 22px", animation: "illoPopIn 420ms 1200ms cubic-bezier(.34,1.56,.64,1) both" }}>
          <g className="illo-anim" style={{ transformOrigin: "22px 22px", animation: "illoPulse 2.8s 1700ms ease-in-out infinite" }}>
            <circle cx="22" cy="22" r="24" fill="#10b981" stroke="#059669" strokeWidth="3" />
          </g>
          <path
            d="M12 23 L19 30 L33 16" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"
            pathLength={100}
            style={{ strokeDasharray: 100, strokeDashoffset: 100, animation: "illoStrokeDraw 400ms 1550ms ease-out both" }}
          />
        </g>
      </g>

      {/* Bandera 🇩🇪 — fade + onda infinito (refuerza idioma) */}
      <g transform="translate(38 38)" className="illo-anim" style={{ transformOrigin: "21px 27px", animation: "illoFadeIn 380ms 400ms ease-out both, illoWave 3.4s 800ms ease-in-out infinite" }}>
        <rect x="0" y="0"  width="42" height="9"  fill="#1e293b" />
        <rect x="0" y="9"  width="42" height="9"  fill="#dc2626" />
        <rect x="0" y="18" width="42" height="9"  fill="#fbbf24" />
        <rect x="0" y="0"  width="42" height="27" fill="none" stroke="#0f172a" strokeWidth="1.5" opacity="0.5" />
      </g>
    </svg>
  );
}

function IllustrationLowBudget() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="70" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Moneda — pop + pulse infinito */}
      <g className="illo-anim" style={{ transformOrigin: "140px 140px", animation: "illoPopIn 480ms cubic-bezier(.34,1.56,.64,1) both, illoPulse 3.4s 700ms ease-in-out infinite" }}>
        <circle cx="140" cy="140" r="70" fill="#fde68a" stroke="#f59e0b" strokeWidth="4" />
        <text x="140" y="155" fontSize="56" textAnchor="middle" fill="#92400e" fontWeight="700">€</text>
      </g>
    </svg>
  );
}

function IllustrationParticulares() {
  // Dos figuras 1-a-1: estudiante a la izquierda, profesor a la
  // derecha (gorro académico), burbuja de chat entre ellos. Paleta
  // brand (warm + amber + cream).
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="100" ry="9" fill="#0f172a" opacity="0.08" />

      {/* ── Estudiante (izquierda) — slide in desde la izquierda ── */}
      <g transform="translate(35 95)" className="illo-anim" style={{ animation: "illoSlideInLeft 520ms ease-out both" }}>
        {/* hombros / cuerpo */}
        <path d="M0 90 Q0 55 35 55 L55 55 Q90 55 90 90 L90 110 L0 110 Z" fill="#fdba74" />
        {/* cabeza */}
        <circle cx="45" cy="32" r="26" fill="#fde68a" />
        {/* pelo */}
        <path d="M22 25 Q28 5 45 5 Q62 5 68 25 Q60 18 45 18 Q30 18 22 25 Z" fill="#92400e" />
        {/* ojos */}
        <circle cx="36" cy="33" r="2.3" fill="#1e293b" />
        <circle cx="54" cy="33" r="2.3" fill="#1e293b" />
        {/* sonrisa */}
        <path d="M37 42 Q45 48 53 42" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>

      {/* ── Burbuja de chat — pop tras los personajes + 3 puntos blink ── */}
      <g transform="translate(108 75)" className="illo-anim" style={{ transformOrigin: "139px 97px", animation: "illoPopIn 380ms 600ms cubic-bezier(.34,1.56,.64,1) both" }}>
        <rect x="0" y="0" width="62" height="44" rx="14" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" />
        {/* "cola" de la burbuja apuntando hacia el profe */}
        <path d="M50 38 L62 50 L54 40 Z" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" />
        {/* 3 puntos chat — blink infinito en stagger */}
        <circle cx="18" cy="22" r="3" fill="#f97316" style={{ animation: "illoBlink 1.4s 1000ms ease-in-out infinite" }} />
        <circle cx="31" cy="22" r="3" fill="#f97316" style={{ animation: "illoBlink 1.4s 1180ms ease-in-out infinite" }} />
        <circle cx="44" cy="22" r="3" fill="#f97316" style={{ animation: "illoBlink 1.4s 1360ms ease-in-out infinite" }} />
      </g>

      {/* ── Profesor (derecha) — slide in desde la derecha ── */}
      <g transform="translate(155 95)" className="illo-anim" style={{ animation: "illoSlideInRight 520ms 80ms ease-out both" }}>
        {/* hombros / cuerpo */}
        <path d="M0 90 Q0 55 35 55 L55 55 Q90 55 90 90 L90 110 L0 110 Z" fill="#f97316" />
        {/* pin "DE" pecho */}
        <circle cx="45" cy="80" r="9" fill="#fff7ed" stroke="#fbbf24" strokeWidth="2" />
        <text x="45" y="83.5" fontSize="9" fontWeight="700" fill="#92400e" textAnchor="middle">DE</text>
        {/* cabeza */}
        <circle cx="45" cy="32" r="26" fill="#fde68a" />
        {/* ojos */}
        <circle cx="36" cy="33" r="2.3" fill="#1e293b" />
        <circle cx="54" cy="33" r="2.3" fill="#1e293b" />
        {/* sonrisa */}
        <path d="M37 42 Q45 48 53 42" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* Gorro académico */}
        <g>
          <rect x="20" y="7" width="50" height="6" fill="#1e293b" />
          <path d="M14 13 L45 0 L76 13 L45 22 Z" fill="#1e293b" />
          {/* borla */}
          <line x1="68" y1="13" x2="74" y2="22" stroke="#fbbf24" strokeWidth="2" />
          <circle cx="74" cy="24" r="3" fill="#fbbf24" />
        </g>
      </g>

      {/* Pequeña corona "1:1" arriba — pop in al final */}
      <g transform="translate(115 30)" className="illo-anim" style={{ transformOrigin: "140px 41px", animation: "illoPopIn 380ms 900ms cubic-bezier(.34,1.56,.64,1) both" }}>
        <rect x="0" y="0" width="50" height="22" rx="11" fill="#fbbf24" />
        <text x="25" y="15.5" fontSize="11" fontWeight="800" fill="#92400e" textAnchor="middle">1 : 1</text>
      </g>
    </svg>
  );
}

function IllustrationSuccess() {
  // Celebración: calendario con check + confetti naranja/ámbar.
  // Renderizada en /confirmacion tras agendar clase de prueba.
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="90" ry="9" fill="#0f172a" opacity="0.08" />
      {/* Confetti — fade-in + rotación lenta infinito alrededor del centro */}
      <g opacity="0.85" className="illo-anim" style={{ transformOrigin: "140px 140px", animation: "illoFadeIn 600ms 700ms ease-out both, illoSpinSlow 28s 1300ms linear infinite" }}>
        <rect x="40"  y="40"  width="10" height="4" rx="2" fill="#f97316" transform="rotate(20 45 42)" />
        <rect x="230" y="50"  width="8"  height="4" rx="2" fill="#fbbf24" transform="rotate(-30 234 52)" />
        <rect x="50"  y="100" width="6"  height="4" rx="2" fill="#34d399" transform="rotate(45 53 102)" />
        <rect x="225" y="105" width="8"  height="4" rx="2" fill="#f97316" transform="rotate(60 229 107)" />
        <rect x="35"  y="170" width="8"  height="4" rx="2" fill="#fbbf24" transform="rotate(-15 39 172)" />
        <rect x="230" y="180" width="10" height="4" rx="2" fill="#34d399" transform="rotate(35 235 182)" />
        <circle cx="55"  cy="65"  r="3" fill="#fbbf24" />
        <circle cx="220" cy="80"  r="3" fill="#f97316" />
        <circle cx="60"  cy="200" r="3" fill="#f97316" />
        <circle cx="215" cy="210" r="3" fill="#fbbf24" />
      </g>
      {/* Círculo verde grande — pop con bounce + pulse infinito */}
      <g className="illo-anim" style={{ transformOrigin: "140px 140px", animation: "illoPopIn 540ms 100ms cubic-bezier(.34,1.56,.64,1) both, illoPulse 3.2s 800ms ease-in-out infinite" }}>
        <circle cx="140" cy="140" r="70" fill="#34d399" />
        <circle cx="140" cy="140" r="70" fill="none" stroke="#10b981" strokeWidth="4" />
      </g>
      {/* Check — stroke draw después del pop del círculo */}
      <path
        d="M108 142 L130 162 L172 118" stroke="white" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none"
        pathLength={100}
        style={{ strokeDasharray: 100, strokeDashoffset: 100, animation: "illoStrokeDraw 480ms 600ms ease-out both" }}
      />
      {/* Estrella — pop + twinkle */}
      <g transform="translate(195 50)" className="illo-anim" style={{ animation: "illoPopIn 380ms 1000ms cubic-bezier(.34,1.56,.64,1) both, illoTwinkle 2.4s 1500ms ease-in-out infinite" }}>
        <polygon points="0,-12 3,-4 12,-3 5,3 7,12 0,7 -7,12 -5,3 -12,-3 -3,-4" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

function IllustrationAlreadyReg() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[180px] md:max-h-[360px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <ellipse cx="140" cy="240" rx="80" ry="8" fill="#0f172a" opacity="0.08" />
      {/* Candado abierto — pop in */}
      <g className="illo-anim" style={{ transformOrigin: "140px 165px", animation: "illoPopIn 500ms cubic-bezier(.34,1.56,.64,1) both" }}>
        <rect x="90" y="135" width="100" height="80" rx="10" fill="#34d399" />
        <path d="M110 135 V100 c0-17 14-30 30-30 12 0 22 7 27 17"
              stroke="#10b981" strokeWidth="10" fill="none" strokeLinecap="round" />
        <circle cx="140" cy="175" r="10" fill="white" />
        <rect x="138" y="175" width="4" height="14" fill="white" />
      </g>
    </svg>
  );
}
