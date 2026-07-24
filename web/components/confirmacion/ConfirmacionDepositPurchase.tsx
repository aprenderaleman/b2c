"use client";

import { useEffect, useRef } from "react";

/**
 * Cliente-only: si la URL trae ?deposito=ok, dispara el evento Purchase
 * por 3 canales (mismo patrón dual que Schedule):
 *
 *   1. Google Ads conversion (label GADS_DEPOSIT_LABEL, transaction_id
 *      dedup nativo).
 *   2. Meta Pixel navegador → fbq('track', 'Purchase', ..., { eventID })
 *   3. Meta CAPI server-side → POST /api/meta-capi con MISMO eventID
 *      → Meta deduplica en ventana 48h.
 *
 * Dedup local: sessionStorage `aa_deposit_purchase_${classId}` bloquea
 * refire si el usuario recarga /confirmacion?deposito=ok.
 *
 * NO toca ConfirmacionPixel (evento Schedule). Ambos coexisten en la
 * página y disparan en su propia condición.
 */
type Win = Window & {
  fbq?:  (...args: unknown[]) => void;
  gtag?: (...args: unknown[]) => void;
};

// Label completo "AW-<id>/<conversion_label>" — env override, fallback
// al valor confirmado por Gelfis 2026-07-24.
const DEPOSIT_LABEL = process.env.NEXT_PUBLIC_GADS_DEPOSIT_LABEL
  ?? "AW-17724667323/sUtlCPGhqcocELvr44NC";
const DEPOSIT_VALUE_EUR = 10.0;

export function ConfirmacionDepositPurchase({
  classId,
  leadEmail,
  leadPhone,
  active,
}: {
  classId:    string;
  leadEmail?: string;
  leadPhone?: string;
  /** Solo dispara cuando true (i.e. ?deposito=ok en la URL). El page
   *  server-side lee searchParams y lo pasa. */
  active:     boolean;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (!active || fired.current) return;
    const storageKey = `aa_deposit_purchase_${classId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(storageKey)) return;
    fired.current = true;
    if (typeof window !== "undefined") sessionStorage.setItem(storageKey, "1");

    const eventId = crypto.randomUUID();
    const w = window as Win;

    // ── Google Ads: Depósito pagado ──────────────────────────────
    // transaction_id único (classId + "-deposit") — dedup nativo, no
    // pisa la conversión Schedule que usa transaction_id=classId puro.
    try {
      w.gtag?.("event", "conversion", {
        send_to:        DEPOSIT_LABEL,
        value:          DEPOSIT_VALUE_EUR,
        currency:       "EUR",
        transaction_id: `${classId}-deposit`,
      });
    } catch (e) {
      console.warn("[deposit-purchase] gtag conversion failed:", e);
    }

    // ── Meta Pixel navegador: Purchase ───────────────────────────
    try {
      w.fbq?.("track", "Purchase", {
        value:    DEPOSIT_VALUE_EUR,
        currency: "EUR",
      }, { eventID: eventId });
    } catch (e) {
      console.warn("[deposit-purchase] fbq Purchase failed:", e);
    }

    // ── Meta CAPI: Purchase (mismo eventID → dedup) ──────────────
    // fbc/fbp los lee el server del Cookie header (fbq los mantiene
    // desde el primer aterrizaje con ?fbclid=...).
    fetch("/api/meta-capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        eventName: "Purchase",
        value:     DEPOSIT_VALUE_EUR,
        currency:  "EUR",
        email:     leadEmail,
        phone:     leadPhone,
        sourceUrl: window.location.href,
      }),
    }).catch(e => console.warn("[deposit-purchase] CAPI call failed:", e));
  }, [active, classId, leadEmail, leadPhone]);

  return null;
}
