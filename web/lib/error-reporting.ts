/**
 * Error reporting wrapper — skeleton listo para Sentry.
 *
 * Hoy: log a consola de Vercel + insert en tabla `error_events`
 * (si existe) para poder consultar desde /admin.
 *
 * Cuando se instale Sentry (@sentry/nextjs):
 *   1. npm install @sentry/nextjs
 *   2. Añadir SENTRY_DSN al env de Vercel Production.
 *   3. Crear sentry.server.config.ts y sentry.client.config.ts según
 *      docs oficiales.
 *   4. En este file, reemplazar el `console.error` con
 *      `Sentry.captureException(err, { extra: context })`.
 *
 * Uso desde un endpoint crítico:
 *
 *   import { reportError } from "@/lib/error-reporting";
 *   try { ... }
 *   catch (err) {
 *     await reportError(err, { endpoint: "book-trial", leadId, ... });
 *     return NextResponse.json({ error: "server_error" }, { status: 502 });
 *   }
 */
import { supabaseAdmin } from "./supabase";

type ErrorContext = {
  endpoint?:  string;
  requestId?: string;
  userId?:    string;
  leadId?:    string;
  classId?:   string;
  [key: string]: unknown;
};

export async function reportError(err: unknown, context: ErrorContext = {}): Promise<void> {
  const e = err as { message?: string; name?: string; stack?: string; code?: string };
  const payload = {
    message: e.message ?? String(err),
    name:    e.name    ?? "Error",
    code:    e.code    ?? null,
    stack:   e.stack?.split("\n").slice(0, 10).join(" | ") ?? null,
    ...context,
  };

  // Log verboso a Vercel — buscar por endpoint en Runtime Logs.
  console.error(`[error-reporting] ${context.endpoint ?? "unknown"}:`, payload);

  // Persistencia opcional en tabla error_events si existe.
  // TODO: cuando se cree migration 094_error_events.sql, activar el
  // insert. Hoy silencioso (evita FK errors en env sin la tabla).
  try {
    const sb = supabaseAdmin();
    await sb.from("error_events").insert({
      endpoint:    String(context.endpoint ?? "unknown"),
      message:     payload.message,
      stack:       payload.stack,
      metadata:    payload,
      created_at:  new Date().toISOString(),
    }).then(() => {}, () => {}); // fail-silent
  } catch { /* ignore */ }

  // TODO(Sentry): descomentar cuando el paquete esté instalado.
  // if (typeof Sentry !== "undefined") {
  //   Sentry.captureException(err, { extra: context });
  // }
}
