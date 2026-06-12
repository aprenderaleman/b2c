import { BrandLogo } from "./BrandLogo";

/**
 * Wrapper compat para el sidebar admin. Delega en BrandLogo (logo único
 * de Aprender-Aleman.de) y mantiene la API anterior (variant / href /
 * size) para no romper los callers.
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
  // Mapeo aproximado del tamaño numérico legacy al sistema sm/md/lg.
  const sized = size <= 30 ? "sm" : size <= 40 ? "md" : "lg";
  return (
    <BrandLogo
      size={sized}
      href={href}
      showWordmark={variant === "full"}
    />
  );
}
