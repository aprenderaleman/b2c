import Image from "next/image";
import Link from "next/link";

/**
 * Aprender-Aleman.de brand mark + wordmark. Uses /public/logo.png
 * (orange/black robot). Two layouts:
 *   - full:    icon + "Aprender-Aleman.de" wordmark (sidebar open)
 *   - compact: icon only                            (sidebar collapsed / mobile)
 */
export function Logo({
  variant = "full",
  href    = "/admin",
  size    = 36,
}: {
  variant?: "full" | "compact";
  href?:    string;
  size?:    number;
}) {
  const img = (
    <Image
      src="/logo.png"
      alt="Aprender-Aleman.de"
      width={size}
      height={size}
      priority
      className="shrink-0"
    />
  );

  if (variant === "compact") {
    return (
      <Link href={href} aria-label="Aprender-Aleman.de" className="inline-flex items-center">
        {img}
      </Link>
    );
  }

  return (
    <Link href={href} className="inline-flex items-center gap-2.5 group">
      {img}
      <span className="flex flex-col leading-tight">
        <span className="text-[13px] font-bold text-slate-900 dark:text-slate-50 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
          Aprender-Aleman
        </span>
        <span className="text-[10px] font-medium tracking-wider uppercase text-slate-400 dark:text-slate-500">
          .de · LMS
        </span>
      </span>
    </Link>
  );
}
