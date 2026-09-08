"use client";

import { useEffect, useRef } from "react";
import { firePixelScheduleGoogle } from "@/lib/pixels";

/**
 * Fires conversion events on /confirmacion mount:
 *   - Google Ads conversion (transaction_id=classId for dedup)
 *   - Meta Pixel "Schedule" (browser-side, con eventID para CAPI dedup)
 *   - Meta CAPI "Schedule" (server-side, mismo eventID)
 *
 * Advanced matching (Gelfis 2026-08-20): antes de disparar Schedule
 * hidratamos fbq con user_data (em, ph, fn, ln, ct, country). Meta
 * documenta que `fbq('init', pixelId, { ... })` reinicia con advanced
 * matching y todo track posterior lo usa. También lo mandamos server-
 * side vía /api/meta-capi con hashing propio. El eventID compartido
 * dedupa entre navegador + CAPI en Test Events y en Events Manager.
 *
 * sessionStorage flag prevents double-fire on page reload.
 */
export function ConfirmacionPixel({
  classId,
  leadId,
  leadEmail,
  leadPhone,
  leadFirstName,
  leadLastName,
  leadCity,
  leadCountry,
  metaPixelId,
}: {
  classId: string;
  leadId?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadFirstName?: string;
  leadLastName?: string;
  leadCity?: string;
  leadCountry?: string;   // ISO-2 lowercase
  metaPixelId?: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    const storageKey = `aa_conv_${classId}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(storageKey)) return;
    fired.current = true;
    if (typeof window !== "undefined") sessionStorage.setItem(storageKey, "1");

    // ── Google Ads conversion (transaction_id=classId dedup nativa) ──
    firePixelScheduleGoogle({ classId, email: leadEmail, phone: leadPhone });

    const eventId = crypto.randomUUID();

    // ── Meta Pixel browser-side con advanced matching ──
    try {
      const w = window as Window & { fbq?: (...args: unknown[]) => void };
      // Advanced matching: re-init con user_data. fbq hashea client-side
      // (SHA-256) los campos PII antes de mandarlos. Solo si tenemos
      // pixelId — sin él, PixelTags no cargó el script y no hay fbq.
      if (metaPixelId && (leadEmail || leadPhone || leadFirstName)) {
        const digits = leadPhone ? leadPhone.replace(/\D/g, "") : "";
        const initData: Record<string, string> = {};
        if (leadEmail)       initData.em = leadEmail.trim().toLowerCase();
        if (digits.length)   initData.ph = digits;
        if (leadFirstName)   initData.fn = leadFirstName.trim().toLowerCase();
        if (leadLastName)    initData.ln = leadLastName.trim().toLowerCase();
        if (leadCity)        initData.ct = leadCity.trim().toLowerCase().replace(/\s+/g, "");
        if (leadCountry)     initData.country = leadCountry.trim().toLowerCase();
        if (leadId)          initData.external_id = leadId;
        w.fbq?.("init", metaPixelId, initData);
      }
      w.fbq?.("track", "Schedule", {}, { eventID: eventId });
    } catch (e) {
      console.warn("[pixel] fbq Schedule failed:", e);
    }

    // ── Meta Conversions API server-side (mismo eventID) ──
    fetch("/api/meta-capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        eventName: "Schedule",
        email:      leadEmail,
        phone:      leadPhone,
        firstName:  leadFirstName,
        lastName:   leadLastName,
        city:       leadCity,
        country:    leadCountry,
        externalId: leadId,
        sourceUrl:  window.location.href,
      }),
    }).catch(e => console.warn("[pixel] CAPI call failed:", e));
  }, [classId, leadId, leadEmail, leadPhone, leadFirstName, leadLastName, leadCity, leadCountry, metaPixelId]);
  return null;
}
