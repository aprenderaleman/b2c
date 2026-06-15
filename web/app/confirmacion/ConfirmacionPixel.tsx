"use client";

import { useEffect } from "react";
import { firePixelScheduleGoogle } from "@/lib/pixels";

/**
 * Dispara la conversion de Google Ads "Clase de prueba reservada"
 * cuando el lead aterriza en /confirmacion. transaction_id=classId
 * garantiza dedup si el usuario refresca o navega de vuelta.
 *
 * Vive como client-component dentro de la página server-rendered de
 * /confirmacion (que SÍ es server por SEO + seguridad — verifica el
 * token HMAC antes de renderizar).
 */
export function ConfirmacionPixel({ classId }: { classId: string }) {
  useEffect(() => {
    firePixelScheduleGoogle({ classId });
  }, [classId]);
  return null;
}
