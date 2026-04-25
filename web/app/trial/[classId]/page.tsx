import { redirect } from "next/navigation";
import Link from "next/link";
import { setTrialSession, verifyTrialToken } from "@/lib/trial-token";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu clase de prueba · Aprender-Aleman.de" };

/**
 * Magic-link landing page for trial-class leads.
 *
 * URL shape: /trial/{classId}?t={signed_token}
 *
 * 1. Validates the HMAC token (lib/trial-token.ts).
 * 2. Confirms the class is the trial it claims to be AND the lead_id
 *    matches the token's lead.
 * 3. Sets the cookie aa_trial_session for 7 days, scoped to /, so the
 *    aula route can authorise without a real user account.
 * 4. Redirects to /aula/{classId} — the existing room flow handles
 *    the open/closed time window from there.
 *
 * If the token is bad or expired, we render a friendly screen instead
 * of bouncing — the lead might just need to ask for a fresh link.
 */
export default async function TrialMagicLinkPage({
  params,
  searchParams,
}: {
  params:        Promise<{ classId: string }>;
  searchParams:  Promise<{ t?: string }>;
}) {
  const { classId } = await params;
  const { t } = await searchParams;

  if (!t) return <BadLinkScreen reason="missing_token" />;

  const payload = verifyTrialToken(t);
  if (!payload) return <BadLinkScreen reason="bad_or_expired" />;
  if (payload.class_id !== classId) return <BadLinkScreen reason="mismatched_class" />;

  // Verify against DB — defends against tokens that survived a class
  // cancellation or lead deletion.
  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, is_trial, status")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return <BadLinkScreen reason="class_missing" />;
  const c = cls as { lead_id: string | null; is_trial: boolean; status: string };
  if (!c.is_trial)            return <BadLinkScreen reason="not_a_trial" />;
  if (c.lead_id !== payload.lead_id) return <BadLinkScreen reason="lead_mismatch" />;
  if (c.status === "cancelled")      return <BadLinkScreen reason="class_cancelled" />;

  await setTrialSession(payload);
  redirect(`/aula/${classId}`);
}

function BadLinkScreen({ reason }: { reason: string }) {
  const messages: Record<string, string> = {
    missing_token:    "Falta la firma del enlace.",
    bad_or_expired:   "Este enlace ha caducado o no es válido.",
    mismatched_class: "El enlace no corresponde a esta clase.",
    class_missing:    "No encontramos la clase.",
    not_a_trial:      "Este enlace solo sirve para clases de prueba.",
    lead_mismatch:    "El enlace no corresponde a tu reserva.",
    class_cancelled:  "Esta clase fue cancelada.",
  };
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="text-5xl mb-4" aria-hidden>🔗</div>
        <h1 className="text-xl font-bold">Enlace no válido</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {messages[reason] ?? "No pudimos verificar el enlace."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Si ya tienes una clase de prueba agendada, búscanos por WhatsApp y te
          mandamos un enlace nuevo.
        </p>
        <Link
          href="/funnel"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-warm text-warm-foreground
                     px-5 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Agendar una nueva clase
        </Link>
      </div>
    </main>
  );
}
