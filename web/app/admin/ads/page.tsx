import { redirect } from "next/navigation";

/**
 * /admin/ads — DEPRECADO (Gelfis 2026-06-16).
 *
 * Unificado en /admin/funnel. Mantenemos este archivo solo para
 * redirigir bookmarks viejos a la nueva URL sin romperlos.
 * Preservamos el query string para mantener filtros activos
 * (?days=7, ?period=week, ?country=ES, etc — /admin/funnel los
 * acepta con la misma semántica).
 *
 * El componente RefreshButton.tsx en este mismo directorio sigue
 * siendo importado por /admin/funnel — NO lo borramos.
 */
export const dynamic = "force-dynamic";

export default async function AdminAdsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) params.set(k, v);
    else if (Array.isArray(v) && v.length > 0) params.set(k, v[0]);
  }
  const qs = params.toString();
  redirect(`/admin/funnel${qs ? `?${qs}` : ""}`);
}
