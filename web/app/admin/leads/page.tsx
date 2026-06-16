import { redirect } from "next/navigation";

/**
 * /admin/leads — DEPRECADO (Gelfis 2026-06-16).
 *
 * Unificado en /admin/funnel. Redirige bookmarks viejos preservando
 * el query string (filtros: ?status, ?motivo, ?q, ?trial=yes,
 * ?cold_call=pending, etc). /admin/funnel acepta los mismos params.
 *
 * Las subrutas /admin/leads/[id] (detalle) y /admin/leads/nuevo
 * (crear) SIGUEN VIVAS — solo se elimina el listado.
 */
export const dynamic = "force-dynamic";

export default async function AdminLeadsRedirect({
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
