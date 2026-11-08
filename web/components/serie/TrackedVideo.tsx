"use client";

import { useEffect, useRef } from "react";

/**
 * Player de la serie con registro de reproducciones (Gelfis 2026-11-08).
 * Envía a /api/student/serie/play:
 *  - "play" la primera vez que arranca (por carga de página),
 *  - "progress" con el % máximo visto cada 30 s, al pausar y al salir
 *    (sendBeacon para que el último progreso sobreviva al cierre).
 * Best-effort: cualquier fallo de red se ignora y el video sigue.
 */
export function TrackedVideo({ slug, src, poster }: {
  slug: string;
  src: string;
  poster?: string;
}) {
  const videoRef   = useRef<HTMLVideoElement | null>(null);
  const playedRef  = useRef(false);   // "play" ya enviado en esta carga
  const maxPctRef  = useRef(0);
  const sentPctRef = useRef(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const pctNow = () => (v.duration > 0 ? Math.round((v.currentTime / v.duration) * 100) : 0);

    const send = (event: "play" | "progress", useBeacon = false) => {
      const payload = JSON.stringify({ slug, event, pct: maxPctRef.current });
      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon("/api/student/serie/play", new Blob([payload], { type: "application/json" }));
        } else {
          fetch("/api/student/serie/play", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
        sentPctRef.current = maxPctRef.current;
      } catch { /* nunca romper el player */ }
    };

    const onPlay = () => {
      if (playedRef.current) return;
      playedRef.current = true;
      send("play");
    };
    const onTime = () => { maxPctRef.current = Math.max(maxPctRef.current, pctNow()); };
    const onPause = () => {
      if (playedRef.current && maxPctRef.current > sentPctRef.current) send("progress");
    };
    const onHide = () => {
      if (playedRef.current && maxPctRef.current > sentPctRef.current) send("progress", true);
    };

    const interval = setInterval(() => {
      if (playedRef.current && !v.paused && maxPctRef.current > sentPctRef.current) send("progress");
    }, 30_000);

    v.addEventListener("play", onPlay);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(interval);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [slug]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      className="h-auto max-h-[80vh] w-full bg-black"
    />
  );
}
