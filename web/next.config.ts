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
};

export default nextConfig;
