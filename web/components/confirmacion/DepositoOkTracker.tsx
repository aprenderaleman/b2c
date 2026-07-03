"use client";

import { useEffect, useRef } from "react";
import { firePixelDepositPaid } from "@/lib/pixels";

/**
 * Client component montado en /confirmacion cuando la URL trae
 * `?deposito=ok`. Hace dos cosas al montar (una sola vez):
 *
 *   1. POST /api/public/mark-deposit-paid con classId + token → marca
 *      classes.deposit_paid_at en BD. El cron send-trial-notifications
 *      leerá esta marca y enviará la variante "plaza asegurada".
 *
 *   2. firePixelDepositPaid — conversión secundaria de Google Ads
 *      (label [PLACEHOLDER_GOOGLE_TAG]). transaction_id=classId dedup
 *      contra refresh y share.
 *
 * Es cliente porque necesitamos gtag (window). Se protege con un ref
 * anti-doble-ejecución (StrictMode + double-render en dev).
 */
export function DepositoOkTracker({ classId, token }: { classId: string; token: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // 1) Persistir marca en BD (idempotente server-side).
    fetch("/api/public/mark-deposit-paid", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, token }),
    }).catch(e => console.warn("[deposito] mark-deposit-paid failed:", e));

    // 2) Conversión secundaria Google Ads.
    firePixelDepositPaid({ classId });
  }, [classId, token]);

  return null;
}
