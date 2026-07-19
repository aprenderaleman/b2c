"use client";

import { useEffect, useRef } from "react";
import { firePixelScheduleGoogle } from "@/lib/pixels";

/**
 * Fires conversion events on /confirmacion mount:
 *   - Google Ads conversion (transaction_id=classId for dedup)
 *   - Meta Pixel "Schedule" (browser-side, with eventID for CAPI dedup)
 *   - Meta CAPI "Schedule" (server-side, same eventID)
 *
 * sessionStorage flag prevents double-fire on page reload.
 */
export function ConfirmacionPixel({
  classId,
  leadEmail,
  leadPhone,
}: {
  classId: string;
  leadEmail?: string;
  leadPhone?: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    const storageKey = `aa_conv_${classId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(storageKey)) return;
    fired.current = true;
    if (typeof window !== "undefined") sessionStorage.setItem(storageKey, "1");

    // Enhanced Conversions: email + phone en el mismo evento
    // (dedup nativo por transaction_id=classId).
    firePixelScheduleGoogle({ classId, email: leadEmail, phone: leadPhone });

    const eventId = crypto.randomUUID();

    // Meta Pixel browser-side Schedule with eventID
    try {
      const w = window as Window & { fbq?: (...args: unknown[]) => void };
      w.fbq?.("track", "Schedule", {}, { eventID: eventId });
    } catch (e) {
      console.warn("[pixel] fbq Schedule failed:", e);
    }

    // Meta Conversions API server-side (same eventID for dedup)
    fetch("/api/meta-capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        email: leadEmail,
        phone: leadPhone,
        sourceUrl: window.location.href,
      }),
    }).catch(e => console.warn("[pixel] CAPI call failed:", e));
  }, [classId, leadEmail, leadPhone]);
  return null;
}
