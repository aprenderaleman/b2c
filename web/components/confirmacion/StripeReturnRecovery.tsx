"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * Fallback client para cuando Stripe redirige a /confirmacion?deposito=ok
 * SIN los params c+t (Payment Links no soportan templating dinámico en el
 * success_url). Rebusca c+t en sessionStorage → localStorage (fallback
 * cross-tab), y si los encuentra re-navega a la URL completa. Si no,
 * muestra un mensaje amable — la clase ya está agendada en BD y el email
 * de confirmación se envía por el cron, así que perder /confirmacion no
 * bloquea al lead.
 *
 * Guarda de tiempo: 24h. Más allá, tratamos como stale (paranoia).
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Stored = { c: string; t: string; at: number };

function loadStored(): Stored | null {
  const read = (get: () => string | null): Stored | null => {
    try {
      const raw = get();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Stored;
      if (!parsed?.c || !parsed?.t || !parsed?.at) return null;
      if (Date.now() - parsed.at > MAX_AGE_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  };
  return (
    read(() => sessionStorage.getItem("b2c.trial_return")) ??
    read(() => localStorage.getItem("b2c.trial_return"))
  );
}

function clearStored() {
  try { sessionStorage.removeItem("b2c.trial_return"); } catch { /* ignore */ }
  try { localStorage.removeItem("b2c.trial_return");   } catch { /* ignore */ }
}

export function StripeReturnRecovery() {
  const [state, setState] = useState<"loading" | "not_found">("loading");

  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      const params = new URLSearchParams({ c: stored.c, t: stored.t, deposito: "ok" });
      // clearStored va en el destino tras que DepositoOkTracker haga POST
      // — aquí no limpiamos por si la re-navegación falla y el lead
      // recarga. El destino sí limpia al montar.
      window.location.replace(`/confirmacion?${params.toString()}`);
      return;
    }
    setState("not_found");
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-slate-600 text-[14px]">
          <span className="inline-block h-5 w-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" aria-hidden />
          Confirmando tu depósito…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900">
      <div className="mx-auto max-w-md px-5 pt-10 pb-16">
        <div className="mb-8"><BrandLogo size="md" /></div>
        <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 p-5">
          <div className="flex items-start gap-3">
            <span className="h-9 w-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 text-lg" aria-hidden>✓</span>
            <div>
              <p className="text-[17px] font-bold text-slate-900 leading-tight">Depósito recibido</p>
              <p className="mt-1.5 text-[14px] text-emerald-900 leading-snug">
                Gracias. Tu clase de prueba está agendada. Te devolveremos los <strong>10€</strong> cuando asistas.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4">
          <p className="text-[13.5px] text-slate-700 leading-relaxed">
            📧 En unos minutos recibirás el <strong>email de confirmación</strong> con la fecha, el enlace al aula virtual y el botón para confirmar tu asistencia.
          </p>
          <p className="mt-2 text-[12.5px] text-slate-500 leading-relaxed">
            Si no lo ves, revisa las carpetas <strong>Promociones</strong> o <strong>Spam</strong>.
          </p>
        </div>
        <Link
          href="/"
          className="mt-6 inline-block text-[13.5px] text-slate-500 hover:text-slate-900 transition-colors"
        >
          ← Volver al inicio
        </Link>
      </div>
    </div>
  );
}
