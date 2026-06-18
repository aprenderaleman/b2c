import Image from "next/image";
import Link from "next/link";

/**
 * Logo único de Aprender-Aleman.de — usar en CUALQUIER header público
 * (landings, homepage, funnel, confirmación, sidebar admin). Reemplaza
 * la mezcla anterior de RobotMark + variantes inline.
 *
 * Composición fija:
 *   - imagen /Logonewwithbg.png (subida por Gelfis a public/)
 *   - wordmark "Aprender-Aleman" + ".de" en naranja (text-warm)
 *
 * Decisión Gelfis 2026-06-14: un solo logo en todo el sitio para que un
 * cambio futuro (rediseño, nueva imagen, distinto wordmark) toque este
 * componente y nada más.
 *
 * Props:
 *   - size: 'sm' (mobile/sidebar compacto) | 'md' (default) | 'lg' (hero)
 *   - href: target del Link (default '/')
 *   - showWordmark: false para variante solo-icono (sidebar admin colapsado)
 *   - theme: 'light' (default — texto oscuro sobre fondo claro) |
 *            'dark' (texto blanco sobre fondo oscuro — sidebar admin).
 *            Antes usábamos `dark:text-white` Tailwind variant, pero esa
 *            depende del system color-scheme; landings con fondo claro
 *            forzado mostraban texto blanco invisible si el usuario tenía
 *            el SO en dark mode. Explicit > automático.
 *   - ariaLabel: accesibilidad
 */
type Size  = "sm" | "md" | "lg";
type Theme = "light" | "dark";

const SIZE_MAP: Record<Size, { img: number; text: string; gap: string }> = {
  sm: { img: 28, text: "text-[14px]",                gap: "gap-2"   },
  md: { img: 36, text: "text-[16px] md:text-[18px]", gap: "gap-2.5" },
  lg: { img: 48, text: "text-[18px] md:text-[20px]", gap: "gap-3"   },
};

export function BrandLogo({
  size = "md",
  href = "/",
  showWordmark = true,
  theme = "light",
  ariaLabel = "Aprender-Aleman.de",
  className = "",
}: {
  size?:         Size;
  href?:         string;
  showWordmark?: boolean;
  theme?:        Theme;
  ariaLabel?:    string;
  className?:    string;
}) {
  const s = SIZE_MAP[size];
  const wordmarkColor = theme === "dark" ? "text-white" : "text-slate-900";
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`inline-flex items-center ${s.gap} active:scale-[0.97] transition ${className}`}
    >
      <Image
        src="/Logonewwithbg.png"
        alt=""
        width={s.img}
        height={s.img}
        priority
        className="rounded-md object-contain shrink-0"
        style={{ width: s.img, height: s.img }}
      />
      {showWordmark && (
        <span className={`font-extrabold tracking-tight ${wordmarkColor} ${s.text}`}>
          Aprender-Aleman<span className="text-warm">.de</span>
        </span>
      )}
    </Link>
  );
}
