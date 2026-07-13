"use client";

import { useEffect, useRef } from "react";
import { firePixelScheduleGoogle } from "@/lib/pixels";

/**
 * Dispara la conversión Google Ads "trial reservado" cuando el lead
 * carga /confirmacion. Se movió aquí desde /agendar/cuando (2026-07-10)
 * para alinear con la práctica estándar de e-commerce: contar la
 * conversión en la thank-you page, no en el submit.
 *
 * Efecto colateral: si el lead completa el form pero el redirect a
 * /confirmacion falla (network hiccup, JS error), NO se cuenta la
 * conversión. Trade-off aceptado — es el 1% edge case, y garantizar
 * que /confirmacion cargó da una señal más limpia a Smart Bidding.
 *
 * transaction_id=classId sigue garantizando dedup nativa: refresh,
 * share del link, multi-tab → Google Ads solo cuenta 1x por classId.
 *
 * Ref-guard anti doble-ejecución en StrictMode + double-render dev.
 */
export function ConfirmacionPixel({ classId }: { classId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    firePixelScheduleGoogle({ classId });
  }, [classId]);
  return null;
}
