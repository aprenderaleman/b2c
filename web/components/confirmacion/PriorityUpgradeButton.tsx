"use client";

import { useState } from "react";

/**
 * Botón "Reservar prioridad por 10€". Llama al endpoint
 * /api/public/deposit-checkout con el classId + token que verifican el
 * dueño de la trial, recibe la URL de Stripe Checkout y hace
 * window.location.href para redirigir.
 *
 * fbclid: si el navegador aún lo tiene en la URL de aterrizaje o en el
 * cookie _fbc (Meta lo mantiene automáticamente en fbq('init')), lo
 * incluimos en el body como respaldo por si el cookie no sobrevive el
 * roundtrip. En prod el CAPI lee _fbc del Cookie header directo.
 */
export function PriorityUpgradeButton({
  classId,
  token,
}: {
  classId: string;
  token:   string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      // Extrae fbclid de la URL actual O del cookie _fbc
      // (formato "fb.1.<ts>.<fbclid>").
      let fbclid: string | undefined;
      const urlFbclid = new URLSearchParams(window.location.search).get("fbclid");
      if (urlFbclid) fbclid = urlFbclid;
      if (!fbclid) {
        const m = document.cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);
        if (m) {
          const parts = decodeURIComponent(m[1]).split(".");
          if (parts.length >= 4) fbclid = parts.slice(3).join(".");
        }
      }

      const res = await fetch("/api/public/deposit-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, token, fbclid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 w-full
                   h-12 md:h-13 rounded-2xl
                   bg-amber-500 hover:bg-amber-600 text-white
                   text-[15px] md:text-[16px] font-bold
                   shadow-lg shadow-amber-500/30
                   active:scale-[0.98] transition
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Cargando…" : "Reservar prioridad por 10€"}
      </button>
      {error && (
        <p className="mt-2 text-center text-[12px] text-red-600">
          {error === "already_paid"
            ? "Ya has activado la Reserva Prioritaria."
            : `No se pudo iniciar el pago (${error}). Recarga e inténtalo de nuevo.`}
        </p>
      )}
    </>
  );
}
