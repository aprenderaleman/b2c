"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDataChannel } from "@livekit/components-react";
import type { DataPublishOptions } from "livekit-client";

/**
 * Pizarra colaborativa del aula (petición Gelfis 2026-09-10, "escribir
 * en pantalla como en Zoom" → opción A: pizarra integrada).
 *
 * - Excalidraw cargado con dynamic import SOLO al abrirse — el bundle
 *   (~1MB) no toca el peso del aula normal. Nada del flujo existente
 *   (video, chat, screen share, grabación) se modifica.
 * - Sincronización por el data channel de LiveKit, topic "whiteboard":
 *   la escena (elements) se difunde con throttle 400ms, troceada en
 *   chunks de 12KB porque LiveKit limita cada paquete a ~15KB.
 * - El profe (host) abre/cierra la pizarra para todos; cualquier
 *   participante puede dibujar (clases de idiomas: el alumno también
 *   escribe). Quien entra tarde pide la escena con {t:"req"} y el host
 *   responde con la copia completa.
 * - Limitación conocida: la pizarra NO queda en la grabación (el
 *   composite egress graba tracks de video, no el DOM). Si el profe
 *   necesita conservarla, Excalidraw permite exportar PNG desde su
 *   propio menú.
 *
 * Last-writer-wins: si dos personas dibujan exactamente a la vez puede
 * perderse un trazo en curso — aceptable en v1 (dibuja sobre todo el
 * profe) y evita meter un CRDT.
 */

// v0.18: los estilos ya no se auto-inyectan — el CSS se importa junto
// al chunk dinámico (solo carga al abrir la pizarra).
const Excalidraw = dynamic(
  async () => {
    // @ts-expect-error — css side-effect import sin tipos
    await import("@excalidraw/excalidraw/index.css");
    return (await import("@excalidraw/excalidraw")).Excalidraw;
  },
  { ssr: false, loading: () => (
    <div className="h-full w-full flex items-center justify-center text-slate-400 text-sm">
      Cargando pizarra…
    </div>
  ) },
);

// API mínima que usamos de Excalidraw — evitamos importar sus tipos en
// el bundle síncrono.
type ExcalidrawAPI = {
  updateScene: (scene: { elements: readonly unknown[] }) => void;
  getSceneElements: () => readonly unknown[];
};

const TOPIC = "whiteboard";
const CHUNK = 12_000;             // chars por paquete (límite LiveKit ~15KB)
const THROTTLE_MS = 400;

type WireMsg =
  | { t: "open" } | { t: "close" } | { t: "req" }
  | { t: "scene"; id: string; seq: number; total: number; part: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

export function WhiteboardPanel({
  open, onOpenChange, isHost,
}: {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  isHost:       boolean;
}) {
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const applyingRemote = useRef(false);
  const lastSentJson   = useRef<string>("");
  const throttleTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkBuffers   = useRef<Map<string, { total: number; parts: Map<number, string> }>>(new Map());
  // Escena recibida antes de que Excalidraw montara (llegó el sync
  // mientras el dynamic import cargaba) — se aplica en cuanto hay API.
  const pendingScene   = useRef<readonly unknown[] | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const sendRef = useRef<((payload: Uint8Array, options: DataPublishOptions) => Promise<void>) | null>(null);

  const sendMsg = useCallback((m: WireMsg) => {
    try {
      sendRef.current?.(enc.encode(JSON.stringify(m)), { reliable: true })
        ?.catch(e => console.warn("[whiteboard] send failed:", e));
    } catch (e) { console.warn("[whiteboard] send failed:", e); }
  }, []);

  const broadcastScene = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const json = JSON.stringify(api.getSceneElements());
    if (json === lastSentJson.current) return;
    lastSentJson.current = json;
    const id = Math.random().toString(36).slice(2, 10);
    const total = Math.max(1, Math.ceil(json.length / CHUNK));
    for (let i = 0; i < total; i++) {
      sendMsg({ t: "scene", id, seq: i, total, part: json.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  }, [sendMsg]);

  const applyScene = useCallback((elements: readonly unknown[], json: string) => {
    lastSentJson.current = json;          // no re-difundir lo que acaba de llegar
    const api = apiRef.current;
    if (!api) { pendingScene.current = elements; return; }
    applyingRemote.current = true;
    try { api.updateScene({ elements }); }
    finally { setTimeout(() => { applyingRemote.current = false; }, 0); }
  }, []);

  const onData = useCallback((msg: { payload: Uint8Array }) => {
    let m: WireMsg;
    try { m = JSON.parse(dec.decode(msg.payload)) as WireMsg; }
    catch { return; }

    if (m.t === "open")  { onOpenChange(true);  return; }
    if (m.t === "close") { onOpenChange(false); return; }
    if (m.t === "req") {
      // Solo el host responde — evita una tormenta de respuestas.
      if (isHost && apiRef.current) {
        lastSentJson.current = "";        // forzar reenvío completo
        broadcastScene();
        if (openRef.current) sendMsg({ t: "open" });
      }
      return;
    }
    if (m.t === "scene") {
      let buf = chunkBuffers.current.get(m.id);
      if (!buf) { buf = { total: m.total, parts: new Map() }; chunkBuffers.current.set(m.id, buf); }
      buf.parts.set(m.seq, m.part);
      if (buf.parts.size === buf.total) {
        chunkBuffers.current.delete(m.id);
        let json = "";
        for (let i = 0; i < buf.total; i++) json += buf.parts.get(i) ?? "";
        try { applyScene(JSON.parse(json) as readonly unknown[], json); }
        catch (e) { console.warn("[whiteboard] scene parse failed:", e); }
      }
      // Limpieza defensiva de buffers viejos.
      if (chunkBuffers.current.size > 20) chunkBuffers.current.clear();
    }
  }, [isHost, onOpenChange, broadcastScene, applyScene, sendMsg]);

  const { send } = useDataChannel(TOPIC, onData);
  sendRef.current = send;

  // Al montar (recién conectado al room), pedir la escena por si la
  // pizarra ya estaba en uso antes de que entráramos.
  useEffect(() => {
    const t = setTimeout(() => sendMsg({ t: "req" }), 1500);
    return () => clearTimeout(t);
  }, [sendMsg]);

  // El host difunde abrir/cerrar para que a todos se les abra sola.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current !== open) {
      prevOpen.current = open;
      if (isHost) sendMsg(open ? { t: "open" } : { t: "close" });
    }
  }, [open, isHost, sendMsg]);

  const onChange = useCallback(() => {
    if (applyingRemote.current) return;
    if (throttleTimer.current) return;
    throttleTimer.current = setTimeout(() => {
      throttleTimer.current = null;
      broadcastScene();
    }, THROTTLE_MS);
  }, [broadcastScene]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 bg-slate-950" role="region" aria-label="Pizarra">
      <Excalidraw
        excalidrawAPI={(api: unknown) => {
          apiRef.current = api as ExcalidrawAPI;
          if (pendingScene.current) {
            const elems = pendingScene.current;
            pendingScene.current = null;
            applyingRemote.current = true;
            try { (api as ExcalidrawAPI).updateScene({ elements: elems }); }
            finally { setTimeout(() => { applyingRemote.current = false; }, 0); }
          }
        }}
        onChange={onChange}
        theme="dark"
        langCode="es-ES"
        UIOptions={{
          canvasActions: {
            loadScene: false,          // no cargar archivos ajenos al aula
            clearCanvas: true,
            export: { saveFileToDisk: true },
            saveToActiveFile: false,
          },
        }}
      />
      {isHost && (
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-3 right-3 z-20 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-100 text-xs font-semibold px-3 py-1.5 shadow-lg"
        >
          ✕ Cerrar pizarra
        </button>
      )}
    </div>
  );
}

/** Botón para la barra de controles — mismo look que los botones lk. */
export function WhiteboardToggleButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`lk-button ${active ? "lk-screen-share-active" : ""}`}
      aria-pressed={active}
      title={active ? "Cerrar pizarra" : "Abrir pizarra"}
    >
      <svg viewBox="0 0 24 24" className="lk-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden>
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
      <span className="hidden sm:inline text-xs ml-1">Pizarra</span>
    </button>
  );
}
