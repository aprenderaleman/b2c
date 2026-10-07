"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Hrefs del chat de plataforma por rol — los ítems que se pintan de
 *  amarillo cuando hay mensajes sin leer (Gelfis 2026-10-10). */
export const CHAT_HREFS = new Set([
  "/profesor/mensajes",
  "/estudiante/mensajes",
  "/admin/chats",
]);

/**
 * Nº de mensajes sin leer del usuario en el chat de plataforma.
 * Poll cada 45s + al volver el foco + al navegar (así el badge cae en
 * cuanto abres la conversación, que marca leído).
 */
export function useChatUnread(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/chat/unread");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUnread(Number(data.unread) || 0);
      } catch { /* offline — mantener el último valor */ }
    };
    void load();
    const t = setInterval(load, 45_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, pathname]);

  return unread;
}
