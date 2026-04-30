import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [],
  },
  // pdfkit ships its built-in fonts as .afm files inside
  // node_modules/pdfkit/js/data — Vercel's serverless tracer doesn't
  // detect those files because pdfkit reads them via `fs.readFileSync`
  // with paths constructed at runtime. Tell Next to bundle them
  // alongside any route that imports pdfkit (factura PDF + certificados),
  // otherwise calling `.font("Helvetica")` blows up with ENOENT and the
  // route returns a 500.
  outputFileTracingIncludes: {
    "/api/admin/finanzas/profesores/**": ["./node_modules/pdfkit/js/data/**/*"],
    "/api/certificates/**":              ["./node_modules/pdfkit/js/data/**/*"],
  },
  // Don't let webpack bundle pdfkit. It uses dynamic require + fs paths
  // relative to its own files, which break once the package is inlined
  // into the route's compiled output. Treating it as an external keeps
  // the original CommonJS resolution at runtime.
  serverExternalPackages: ["pdfkit"],

  // Security headers — Vercel only sets HSTS by default. The rest are
  // industry-standard defences (clickjacking, MIME-sniff, referrer,
  // mic/cam autograb on iframes…). CSP starts permissive enough to
  // not break Stripe/LiveKit/Schule embeds; tighten later via
  // report-only first if we want to be stricter.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options",        value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Allow camera/mic on /aula and /trial (LiveKit). Block
            // everything else by default.
            value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(self)",
          },
          {
            // Loose CSP — does not block anything, just reports.
            // Once we confirm zero violations in production logs we
            // can swap "Content-Security-Policy-Report-Only" for the
            // enforcing variant and tighten the directives.
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self' https: data: blob:",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.vercel-analytics.com https://*.vercel-insights.com",
              "style-src 'self' 'unsafe-inline' https:",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https: wss: blob: data:",
              "frame-src 'self' https://*.stripe.com https://schule.aprender-aleman.de https://hans.aprender-aleman.de",
              "media-src 'self' blob: https:",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://*.stripe.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
