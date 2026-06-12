import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Permitimos crawl de todo el sitio público; bloqueamos lo
        // privado / API / admin / panel del profesor / aula.
        allow:    "/",
        disallow: [
          "/admin/",
          "/api/",
          "/aula/",
          "/teacher/",
          "/login",
          "/onboarding/",
          "/landing-anterior",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
