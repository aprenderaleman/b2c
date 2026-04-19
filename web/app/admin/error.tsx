"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Catches any server-side rendering exception in the admin area and
 * shows a developer-friendly page with the actual error message.
 * Replaces Next's default "Application error" opaque page.
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/error-handling
 */
export default function AdminErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("AdminErrorBoundary caught:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-3xl border border-red-200 dark:border-red-500/40 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="text-3xl" aria-hidden>⚠️</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
              Error en el panel de admin
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              El servidor lanzó una excepción al renderizar esta página.
              El detalle está abajo para poder diagnosticarlo rápido.
            </p>

            <dl className="mt-4 text-xs space-y-1 font-mono">
              <div className="flex gap-3">
                <dt className="text-slate-500 w-20">message:</dt>
                <dd className="text-red-700 dark:text-red-300 break-all">{error.message}</dd>
              </div>
              {error.digest && (
                <div className="flex gap-3">
                  <dt className="text-slate-500 w-20">digest:</dt>
                  <dd className="text-slate-700 dark:text-slate-300">{error.digest}</dd>
                </div>
              )}
              <div className="flex gap-3">
                <dt className="text-slate-500 w-20">name:</dt>
                <dd className="text-slate-700 dark:text-slate-300">{error.name}</dd>
              </div>
            </dl>

            {error.stack && (
              <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre">
                {error.stack}
              </pre>
            )}

            <div className="mt-5 flex items-center gap-2">
              <button type="button" onClick={() => reset()} className="btn-primary text-sm">
                Reintentar
              </button>
              <Link href="/login" className="btn-secondary text-sm">
                Volver a /login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
