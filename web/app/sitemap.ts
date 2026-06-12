/**
 * Sitemap generado dinámicamente. Incluye la home + las 6 landings
 * dedicadas para SEO (post-2026-06-XX). Las rutas /admin, /aula y
 * /api quedan fuera — no son indexables.
 */
import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  // lastModified=ahora para que las páginas se vean siempre "frescas".
  // Cuando hagamos cambios sustanciales en una landing podemos pinearle
  // su propia fecha; mientras tanto la home y las landings van juntas.
  const now = new Date();

  const routes = [
    { url: `${BASE}/`,                                  priority: 1.0,  changeFrequency: "weekly" as const },
    { url: `${BASE}/curso-aleman-online`,              priority: 0.9,  changeFrequency: "weekly" as const },
    { url: `${BASE}/clases-particulares-aleman-online`, priority: 0.95, changeFrequency: "weekly" as const },
    { url: `${BASE}/curso-intensivo-aleman`,           priority: 0.9,  changeFrequency: "weekly" as const },
    { url: `${BASE}/curso-aleman-certificado`,         priority: 0.85, changeFrequency: "weekly" as const },
    { url: `${BASE}/aleman-b2-trabajar`,               priority: 0.85, changeFrequency: "weekly" as const },
    { url: `${BASE}/clases-aleman-ciudades`,           priority: 0.8,  changeFrequency: "weekly" as const },
  ];

  return routes.map(r => ({ ...r, lastModified: now }));
}
