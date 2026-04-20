/**
 * Aprender-Aleman.de robot mark — inline SVG version.
 *
 * Replaces the old /public/logo.png, which had thin black outlines on a
 * transparent background and disappeared against dark slate surfaces.
 *
 * This version uses filled shapes with brand colours so it's crisp on
 * light OR dark backgrounds without needing two asset files:
 *
 *   - Head: white (always) — keeps the classic happy-robot face.
 *   - Head ring: slate-200 in light / slate-700 in dark — ties the
 *     white head into the surrounding surface subtly.
 *   - Orange: brand-500 everywhere (headphones, antenna, eyes, book).
 *   - Visor: dark slate with a soft glow to sell the "screen" look.
 *
 * Renders at any size — viewBox is 80×80. `size` prop is a CSS pixel
 * value for width + height.
 */
export function RobotMark({ size = 40, className = "" }: {
  size?:      number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {/* Antenna — orange bulb on a short stem */}
      <line x1="40" y1="6" x2="40" y2="14"
            stroke="#F97316" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="40" cy="5" r="3.5" fill="#F97316" />

      {/* Headphones — flanking orange discs */}
      <rect x="6"  y="30" width="11" height="18" rx="5.5" fill="#F97316" />
      <rect x="63" y="30" width="11" height="18" rx="5.5" fill="#F97316" />

      {/* Headband connecting the headphones, sitting on top of the head */}
      <path d="M 11 30 C 11 16, 27 12, 40 12 C 53 12, 69 16, 69 30"
            fill="none" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />

      {/* Head — white rounded square with an adaptive ring */}
      <rect
        x="14" y="16" width="52" height="44" rx="15"
        fill="#FFFFFF"
        className="stroke-slate-200 dark:stroke-slate-700"
        strokeWidth="2"
      />

      {/* Visor — dark panel for the face */}
      <rect x="22" y="26" width="36" height="18" rx="8" fill="#0F172A" />

      {/* Eye glow */}
      <circle cx="31" cy="35" r="4.6" fill="#FDBA74" />
      <circle cx="49" cy="35" r="4.6" fill="#FDBA74" />
      {/* Eye pupils */}
      <circle cx="31" cy="35" r="2.2" fill="#F97316" />
      <circle cx="49" cy="35" r="2.2" fill="#F97316" />

      {/* Smile */}
      <path d="M 32 52 Q 40 57 48 52"
            fill="none" stroke="#0F172A" strokeWidth="2.6" strokeLinecap="round" />

      {/* Body hint — small neck/torso peeking below the head */}
      <rect x="28" y="60" width="24" height="5" rx="2" fill="#FFFFFF"
            className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="2" />

      {/* Book — held in front, orange cover with spine + text lines */}
      <rect x="18" y="63" width="44" height="14" rx="2" fill="#F97316" />
      <line x1="40" y1="63" x2="40" y2="77" stroke="#C2410C" strokeWidth="1.5" />
      <path d="M 23 68 L 36 68 M 23 72 L 34 72 M 44 68 L 57 68 M 46 72 L 57 72"
            stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
