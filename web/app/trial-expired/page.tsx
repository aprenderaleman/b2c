import Link from "next/link";

/**
 * Fallback shown when the magic-link Route Handler at
 * /trial/[classId] (or /c/[code]) decides the link is bad — expired,
 * tampered, mismatched lead, or pointing at a cancelled class.
 *
 * The Route Handler redirects here with `?reason=...` so we can show
 * a tailored message without needing client-side JS.
 */
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  missing_token:    "Falta la firma del enlace.",
  bad_or_expired:   "Este enlace ha caducado o no es válido.",
  mismatched_class: "El enlace no corresponde a esta clase.",
  class_missing:    "No encontramos la clase.",
  not_a_trial:      "Este enlace solo sirve para clases de prueba.",
  lead_mismatch:    "El enlace no corresponde a tu reserva.",
  class_cancelled:  "Esta clase fue cancelada.",
  unknown_code:     "No reconocemos este enlace.",
};

export default async function TrialExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = MESSAGES[reason ?? ""] ?? "No pudimos verificar el enlace.";

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="text-5xl mb-4" aria-hidden>🔗</div>
        <h1 className="text-xl font-bold">Enlace no válido</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Si ya tienes una clase de prueba agendada, búscanos por WhatsApp y
          te mandamos un enlace nuevo.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-warm text-warm-foreground
                     px-5 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Agendar una nueva clase
        </Link>
      </div>
    </main>
  );
}
