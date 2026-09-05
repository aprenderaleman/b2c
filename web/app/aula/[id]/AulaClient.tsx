"use client";

import "@livekit/components-styles";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  PreJoin,
  ControlBar,
  GridLayout,
  FocusLayout,
  FocusLayoutContainer,
  CarouselLayout,
  ParticipantTile,
  RoomAudioRenderer,
  Chat,
  useChat,
  useTracks,
  useParticipants,
  useLocalParticipant,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import type { LocalUserChoices } from "@livekit/components-core";
import { RoomEvent, Track, ParticipantEvent, type Participant } from "livekit-client";
import { VirtualBackgroundButton, BRAND_IMAGES, BG_LABELS, type BgMode } from "./VirtualBackgroundButton";

type Props = {
  classId:          string;
  classTitle:       string;
  scheduledAt:      string;
  durationMinutes:  number;
  isHost:           boolean;
  /** "host" = teacher / admin observer; "student" = enrolled student;
   *  "lead" = trial-magic-link visitor without a user row. Used to
   *  decide where to send them on disconnect. */
  audience?:        "host" | "student" | "lead";
  displayName:      string;
  backHref:         string;
  /** Habilita la opción "Fondo Aprender-Aleman.de" en el selector de
   *  fondo virtual. Rollout: admin/superadmin primero, luego profes. */
  brandBackground?: boolean;
  /** Sesión de Plan-Alemán (closer). Cuando true y audience=lead,
   *  oculta controles de mic/cámara al lead — experimental. */
  isSesionPlan?: boolean;
};

/**
 * Branded live classroom. Renders LiveKit video + our own top bar and
 * "end class" flow for the teacher. Connection token is fetched once
 * from /api/aula/[id]/token; the LiveKit components take care of the
 * rest of the media pipeline.
 *
 * Layout rules:
 *   - If anybody is sharing a screen → FOCUS on that screen, everyone
 *     else shrinks to a bottom carousel. Auto-switches back when the
 *     share stops.
 *   - If a teacher/participant clicks a tile → that tile gets pinned
 *     as focus (overrides the auto-focus until manually un-pinned).
 *   - Otherwise → even grid.
 *
 * Teacher powers (only when isHost):
 *   - Hover any participant tile → buttons for 🔇 mute mic · 🎥 stop
 *     video · 👢 kick.
 *   - "Terminar clase para todos" in the top bar → disconnects
 *     everyone and marks the class as completed.
 */
/**
 * Detección de in-app WebViews (WhatsApp, Instagram, Facebook, TikTok,
 * Gmail app…) — sobre todo en iOS. Estos WebViews NO soportan WebRTC
 * (o lo hacen roto), así que si el lead abre el link desde ahí, ninguna
 * corrección de PreJoin/handoff sirve: hay que sacarlo a Safari/Chrome.
 *
 * UA fingerprints:
 *   - WhatsApp iOS: "WhatsApp/24.x.x.x"
 *   - Instagram:    "Instagram xx.x.x.x"
 *   - Facebook:     "FBAN/…" o "FBAV/…" o "FB_IAB/…"
 *   - TikTok:       "musical_ly" o "Bytedance"
 *   - Gmail app:    "GSA/…"
 */
function isInAppWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|musical_ly|Bytedance|GSA/i.test(ua);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function AulaClient(p: Props) {
  const [token, setToken]         = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatOpen,  setChatOpen]  = useState(false);
  const [webViewBlocker, setWebViewBlocker] = useState(false);

  // Detección WebView tras hidratación (SSR-safe). Se muestra un
  // interstitial que pide abrir en Safari/Chrome antes de intentar
  // cualquier getUserMedia — en iOS WhatsApp/IG WebView no hay WebRTC.
  useEffect(() => {
    if (isInAppWebView()) setWebViewBlocker(true);
  }, []);

  // PreJoin screen — el usuario ve preview de su cámara, mide nivel
  // del micro, escoge dispositivos y decide entrar con cam/mic on/off
  // ANTES de conectar a LiveKit. Igual al "Listo para unirte" de
  // Google Meet. Hasta que `userChoices` no esté seteado, no
  // montamos `<LiveKitRoom>`.
  //
  // Antes hacíamos un probe propio con getUserMedia + cascada de
  // fallbacks. PreJoin hace lo mismo internamente y además da
  // controles UI al usuario, así que el probe se elimina.
  const [userChoices, setUserChoices] = useState<LocalUserChoices | null>(null);
  // Fondo virtual elegido en el lobby — se aplica automáticamente al
  // entrar (VirtualBackgroundButton initialMode) y puede cambiarse
  // luego mid-call desde la barra inferior.
  const [bgChoice, setBgChoice] = useState<BgMode>("off");
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);
  // "handoff": tras submit del PreJoin, esperamos antes de montar
  // LiveKitRoom. iOS Safari sólo permite UN getUserMedia por origen a
  // la vez, y si Room intenta pedir cámara/mic mientras PreJoin aún
  // los tiene, LiveKit aborta con "Client initiated disconnect". El
  // gap deja que el cleanup de PreJoin libere las tracks (Leana
  // 2026-07-28). En móvil el gap es mayor: 400 ms no bastaban en
  // Android de gama media (Francisco/Marcela 2026-08-26).
  const [roomReady, setRoomReady] = useState(false);
  // Reintento automático del connect: cuando el handshake aborta con
  // "client initiated disconnect" ANTES de llegar a conectar, no
  // mostramos el error — desmontamos LiveKitRoom, esperamos un gap
  // mayor y remontamos, hasta 2 veces. Solo tras agotar reintentos el
  // usuario ve la pantalla de error (Francisco/Marcela 2026-08-26:
  // perdimos una clase de prueba por este error en primer intento).
  const [connectAttempt, setConnectAttempt] = useState(0);
  const connectedRef = useRef(false);
  const isMobileUa = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const handoffMs = (isMobileUa ? 1000 : 400) + connectAttempt * 800;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/aula/${p.classId}/token`, { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (!cancelled) setError(data.reason ?? "error");
          return;
        }
        if (!cancelled) {
          setToken(data.token);
          setServerUrl(data.url);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "network");
      }
    })();
    return () => { cancelled = true; };
  }, [p.classId]);

  // Retry manual (botón "Reintentar"): conserva la selección del
  // PreJoin — repetir todo el lobby re-creaba la misma carrera de
  // getUserMedia que causó el fallo. Solo re-monta LiveKitRoom tras
  // un handoff largo. El token sigue siendo válido (TTL 2h).
  const retry = () => {
    setError(null);
    setRoomReady(false);
    setConnectAttempt(a => a + 1);
    if (!token || !serverUrl) {
      // El fallo fue ANTES de tener token (auth/red) — reset completo
      // para que el useEffect vuelva a pedirlo.
      setToken(null);
      setServerUrl(null);
      setUserChoices(null);
    }
  };

  if (webViewBlocker) return <WebViewBlockerScreen classTitle={p.classTitle} onIgnore={() => setWebViewBlocker(false)} />;
  if (error) return <ErrorScreen reason={error} backHref={p.backHref} onRetry={retry} />;
  if (!token || !serverUrl) return <LoadingScreen classTitle={p.classTitle} />;

  // Pre-join: el usuario verifica cámara/mic + escoge dispositivos
  // antes de conectar. Estilo Google Meet "Ready to join".
  if (!userChoices) {
    return (
      <AulaPreJoin
        classTitle={p.classTitle}
        defaultName={p.displayName}
        backHref={p.backHref}
        background={bgChoice}
        onBackgroundChange={setBgChoice}
        brandEnabled={p.brandBackground}
        onSubmit={(choices) => setUserChoices(choices)}
        onError={(e) => {
          console.warn("[aula/prejoin] media error:", e);
          setMediaWarning(
            "Tu navegador no permitió usar cámara o micrófono. " +
            "Puedes entrar como espectador o recargar y pulsar 'Permitir'.",
          );
        }}
      />
    );
  }

  // Handoff: PreJoin ya desmontó (esta rama ni siquiera pasó a
  // renderizarlo), pero necesitamos ~400 ms para que iOS libere
  // el getUserMedia antes de que LiveKitRoom lo pida.
  if (!roomReady) {
    return (
      <>
        <HandoffScreen classTitle={p.classTitle} />
        <HandoffTimer onReady={() => setRoomReady(true)} delayMs={handoffMs} />
      </>
    );
  }

  // Mapeamos las elecciones del usuario en PreJoin → opciones de
  // captura de LiveKit. Si el usuario seleccionó un device específico,
  // pasamos `{ deviceId: ... }`; si no, pasamos `true`/`false`.
  const audioCapture = userChoices.audioEnabled
    ? (userChoices.audioDeviceId ? { deviceId: userChoices.audioDeviceId } : true)
    : false;
  const videoCapture = userChoices.videoEnabled
    ? (userChoices.videoDeviceId ? { deviceId: userChoices.videoDeviceId } : true)
    : false;

  return (
    <main className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <LiveKitRoom
        key={connectAttempt}
        token={token}
        serverUrl={serverUrl}
        connect={true}
        video={videoCapture}
        audio={audioCapture}
        data-lk-theme="default"
        onConnected={() => { connectedRef.current = true; }}
        onError={(e) => {
          // Log completo para diagnóstico (aparece en Vercel client
          // logs vía Sentry si está montado, o al menos en la consola
          // del navegador — pídele al usuario un screenshot).
          console.error("[aula/livekit] onError:", {
            name:    (e as Error).name,
            message: (e as Error).message,
            attempt: connectAttempt,
          });
          const msg = (e as Error).message;
          // Aborto en pleno handshake (carrera getUserMedia) ANTES de
          // llegar a conectar → reintento automático silencioso con
          // handoff más largo, hasta 2 veces. El usuario solo ve
          // "Conectando…" un poco más.
          if (/client initiated disconnect/i.test(msg) && !connectedRef.current && connectAttempt < 2) {
            setRoomReady(false);
            setConnectAttempt(a => a + 1);
            return;
          }
          setError(msg);
        }}
        onMediaDeviceFailure={(failure) => {
          // Runtime permission denial or missing device mid-connect — keep
          // the user in the room as a listener instead of dropping them.
          console.warn("[aula] media device failure:", failure);
          setMediaWarning(
            failure === "PermissionDenied"
              ? "No diste permiso para micrófono/cámara. Puedes usar solo escucha o recargar y aceptar."
              : "Tu dispositivo no pudo activar cámara o micrófono. Sigues conectado como espectador.",
          );
        }}
        onDisconnected={() => {
          // Un connect fallido también dispara onDisconnected. Si nunca
          // llegamos a estar conectados, NO redirigir — dejar que el
          // auto-retry / pantalla de error manejen la situación (hoy
          // esto echaba al lead a la web pública en pleno reintento).
          if (!connectedRef.current) return;
          // Decide where to send the user when LiveKit disconnects:
          //   host    → /profesor (handled by HostTeardown via custom event)
          //   student → su dashboard /estudiante (decisión Gelfis 2026-05-14:
          //             antes los mandábamos a SCHULE como "keep the
          //             learning loop tight", pero confundía — preferimos
          //             devolverlos al dashboard donde ven sus próximas
          //             clases, materiales, grabaciones, etc.)
          //   lead    → bounce al público para que no se queden en
          //             /aula colgado.
          if (p.isHost) {
            // HostTeardown handles this branch with router.push so SSR
            // state survives. Just emit the legacy event for it.
            window.dispatchEvent(new CustomEvent("livekit:disconnected", {
              detail: { event: RoomEvent.Disconnected },
            }));
            return;
          }
          if (p.audience === "lead") {
            window.location.href = "https://aprender-aleman.de";
            return;
          }
          // Default = student → dashboard del alumno.
          window.location.href = "/estudiante";
        }}
        className="flex-1 min-h-0 flex flex-col"
      >
        {mediaWarning && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-100 text-xs px-4 py-2 flex items-center justify-between gap-3">
            <span>⚠️ {mediaWarning}</span>
            <button
              type="button"
              onClick={() => setMediaWarning(null)}
              className="text-amber-200/80 hover:text-amber-100 text-lg leading-none"
              aria-label="Cerrar aviso"
            >×</button>
          </div>
        )}
        <TopBar
          classId={p.classId}
          title={p.classTitle}
          scheduledAt={p.scheduledAt}
          durationMinutes={p.durationMinutes}
          isHost={p.isHost}
          backHref={p.backHref}
          panelOpen={panelOpen}
          onToggleParticipants={() => setPanelOpen(o => !o)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen(o => !o)}
        />
        {/* relative: el chat flota como overlay sobre el video en vez de
            robarle ancho (queja Gelfis 2026-08 — el <aside> en flex
            encogía la zona de video). */}
        <div className="flex-1 min-h-0 flex bg-slate-900 relative">
          <div className="flex-1 min-w-0 h-full">
            <VideoArea classId={p.classId} isHost={p.isHost} />
          </div>
          {panelOpen && (
            <ParticipantsPanel onClose={() => setPanelOpen(false)} />
          )}
          <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        </div>
        <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-2">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <ControlBar
              controls={{
                microphone:  !(p.isSesionPlan && p.audience === "lead"),
                camera:      !(p.isSesionPlan && p.audience === "lead"),
                screenShare: false,
                chat:        false,
                leave:       true,
              }}
            />
            {p.audience !== "lead" && <SafeScreenShareButton />}
            <VirtualBackgroundButton
              canCamera={userChoices.videoEnabled}
              brandEnabled={p.brandBackground}
              initialMode={bgChoice}
            />
          </div>
        </div>
        <RoomAudioRenderer />
        {p.isHost && <HostTeardown classId={p.classId} backHref={p.backHref} />}
        {p.isHost && <RecordingAutoStart classId={p.classId} />}
      </LiveKitRoom>
    </main>
  );
}

// ───────────────────────────────────────────────────────────────────
// Video layout — auto-focus when someone shares their screen; user
// can also click to manually pin a tile.
// ───────────────────────────────────────────────────────────────────
function VideoArea({ classId, isHost }: { classId: string; isHost: boolean }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera,      withPlaceholder: true  },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  // Auto-focus whenever someone is sharing their screen.
  const focused: TrackReferenceOrPlaceholder | null = useMemo(
    () => tracks.find(t => t.source === Track.Source.ScreenShare) ?? null,
    [tracks],
  );

  const others = useMemo(
    () => focused ? tracks.filter(t => t !== focused) : tracks,
    [tracks, focused],
  );

  if (!focused) {
    return (
      <GridLayout tracks={tracks} style={{ height: "100%" }}>
        <ModeratedTile classId={classId} isHost={isHost} />
      </GridLayout>
    );
  }

  return (
    <FocusLayoutContainer>
      <CarouselLayout tracks={others}>
        <ModeratedTile classId={classId} isHost={isHost} />
      </CarouselLayout>
      <FocusLayout trackRef={focused} />
    </FocusLayoutContainer>
  );
}

// ───────────────────────────────────────────────────────────────────
// Tile with (host-only) moderation overlay on hover.
// ───────────────────────────────────────────────────────────────────
function ModeratedTile({ classId, isHost }: { classId: string; isHost: boolean }) {
  return (
    <div className="relative h-full w-full group">
      <ParticipantTile />
      {isHost && <HostOverlay classId={classId} />}
    </div>
  );
}

function HostOverlay({ classId }: { classId: string }) {
  const participants = useParticipants();
  // Inner tile gives us the ParticipantContext via the nearest React tree,
  // but to identify "which tile are we in?" we locate the wrapping element
  // by looking up data-lk-local-participant / data-lk-participant-identity
  // attributes LiveKit sets on each tile. We read the identity from the
  // nearest ancestor with that attribute on mouse enter.
  const [identity, setIdentity] = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const onEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget.closest("[data-lk-participant-identity]") as HTMLElement | null;
    const id = el?.getAttribute("data-lk-participant-identity") ?? null;
    if (id !== identity) setIdentity(id);
  }, [identity]);

  const { localParticipant } = useLocalParticipant();
  const isSelf = identity === localParticipant.identity;
  const participant: Participant | undefined = useMemo(
    () => participants.find(p => p.identity === identity),
    [participants, identity],
  );

  const call = async (action: "mute_audio" | "mute_video" | "kick") => {
    if (!identity || isSelf || busy) return;
    if (action === "kick" && !confirm(`Expulsar a ${participant?.name ?? identity} del aula?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/aula/${classId}/moderate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, identity }),
      });
      if (!res.ok) setErr((await res.json())?.error ?? "error");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseEnter={onEnter}
      className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
    >
      {/* Only show actions on other participants' tiles */}
      {identity && !isSelf && (
        <>
          <HostBtn title="Silenciar micrófono" onClick={() => call("mute_audio")} busy={busy}>🔇</HostBtn>
          <HostBtn title="Apagar cámara"       onClick={() => call("mute_video")} busy={busy}>🎥</HostBtn>
          <HostBtn title="Expulsar del aula"   onClick={() => call("kick")}       busy={busy} danger>👢</HostBtn>
        </>
      )}
      {err && <span className="text-[10px] text-red-300 bg-black/60 px-2 py-0.5 rounded">{err}</span>}
    </div>
  );
}

function HostBtn({
  title, onClick, busy, danger, children,
}: {
  title: string; onClick: () => void; busy: boolean;
  danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-full text-sm shadow-md transition-colors
        ${danger
          ? "bg-red-500/90 hover:bg-red-500 text-white"
          : "bg-slate-800/90 hover:bg-slate-700 text-white"}
        disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// Custom screen share button — pasa audio:false y systemAudio:exclude
// para que compartir pantalla NO silencie el micrófono del presenter.
// ControlBar no acepta opciones de captura, así que lo hacemos manual.
// ───────────────────────────────────────────────────────────────────
function SafeScreenShareButton() {
  const { localParticipant } = useLocalParticipant();
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setSharing(localParticipant.isScreenShareEnabled);
    const onChange = () => setSharing(localParticipant.isScreenShareEnabled);
    localParticipant.on(ParticipantEvent.TrackPublished, onChange);
    localParticipant.on(ParticipantEvent.TrackUnpublished, onChange);
    localParticipant.on(ParticipantEvent.LocalTrackPublished, onChange);
    return () => {
      localParticipant.off(ParticipantEvent.TrackPublished, onChange);
      localParticipant.off(ParticipantEvent.TrackUnpublished, onChange);
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onChange);
    };
  }, [localParticipant]);

  const toggle = async () => {
    try {
      await localParticipant.setScreenShareEnabled(!sharing, {
        audio: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "exclude",
      });
    } catch {
      // User cancelled the screen share picker — no action needed.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`lk-button lk-screen-share-button ${sharing ? "lk-screen-share-active" : ""}`}
      aria-pressed={sharing}
      title={sharing ? "Dejar de compartir" : "Compartir pantalla"}
    >
      <svg viewBox="0 0 24 24" className="lk-button-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────
// Top bar + teacher "end class" button + teardown hook
// ───────────────────────────────────────────────────────────────────
function TopBar({
  classId, title, scheduledAt, durationMinutes, isHost, backHref,
  panelOpen, onToggleParticipants,
  chatOpen, onToggleChat,
}: {
  classId: string; title: string; scheduledAt: string; durationMinutes: number;
  isHost: boolean; backHref: string;
  panelOpen: boolean; onToggleParticipants: () => void;
  chatOpen:  boolean; onToggleChat:         () => void;
}) {
  const participants = useParticipants();
  // Track unread chat messages while the panel is closed. Resets to the
  // current count whenever the user opens the panel.
  const { chatMessages } = useChat();
  const [seenCount, setSeenCount] = useState(0);
  useEffect(() => {
    if (chatOpen) setSeenCount(chatMessages.length);
  }, [chatOpen, chatMessages.length]);
  const unread = chatOpen ? 0 : Math.max(0, chatMessages.length - seenCount);
  const speaking = participants.find(p => p.isSpeaking) ?? null;
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(scheduledAt).getTime()) / 1000)));

  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(scheduledAt).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [scheduledAt]);

  const router = useRouter();
  const [ending, setEnding] = useState(false);
  // Cuándo entró el profe a la sala — para detectar el "falso arranque"
  // (caso Sabine/Jeaneth 2026-08-25: entró, no vio video aún, terminó la
  // clase a los 20 segundos con la alumna dentro).
  const joinedAtRef = useRef(Date.now());

  const endClass = async () => {
    const inRoomSec = (Date.now() - joinedAtRef.current) / 1000;
    const othersPresent = participants.length > 1;
    if (inRoomSec < 180 && othersPresent) {
      if (!confirm(
        "⚠️ Acabas de entrar y hay participantes en la sala.\n\n" +
        "Si no ves el video de alguien, espera unos segundos — la cámara " +
        "puede tardar en arrancar (sobre todo con el fondo virtual). " +
        "Terminar la clase expulsará a todos y cerrará la sala.\n\n" +
        "¿Seguro que quieres TERMINAR la clase para todos?"
      )) return;
    } else if (!confirm("¿Terminar clase para TODOS? Se desconectarán profesor y estudiantes.")) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/aula/${classId}/moderate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "end_class" }),
      });
      if (!res.ok) {
        alert("No se pudo terminar la clase — inténtalo otra vez.");
        setEnding(false);
        return;
      }
      // Redirect the teacher to the end-class confirmation flow
      router.push(`${backHref}?end=1`);
    } catch {
      setEnding(false);
    }
  };

  return (
    <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Link href={backHref} className="text-sm text-slate-400 hover:text-brand-400 shrink-0">
          ←
        </Link>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate text-slate-100">{title}</div>
          <div className="text-xs text-slate-400 font-mono">
            {formatElapsed(elapsed)} / {durationMinutes}:00
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {speaking && (
          <span
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-brand-500/20 ring-1 ring-brand-400/40 px-2.5 py-0.5 text-xs font-medium text-brand-200 max-w-[180px] truncate"
            title={`${speaking.name || speaking.identity} está hablando`}
          >
            🎙️ <span className="truncate">{speaking.name || speaking.identity}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggleChat}
          className={`relative inline-flex items-center gap-1.5 rounded-full text-xs font-medium px-2.5 py-0.5 transition-colors
                      ${chatOpen
                        ? "bg-brand-500 text-white"
                        : "bg-slate-700/80 hover:bg-slate-600/80 text-slate-200"}`}
          title="Chat de la clase"
          aria-pressed={chatOpen}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Chat
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleParticipants}
          className={`inline-flex items-center gap-1.5 rounded-full text-xs font-medium px-2.5 py-0.5 transition-colors
                      ${panelOpen
                        ? "bg-brand-500 text-white"
                        : "bg-slate-700/80 hover:bg-slate-600/80 text-slate-200"}`}
          title="Ver participantes"
          aria-pressed={panelOpen}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {participants.length}
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {isHost ? "Eres profesor" : "Participante"}
        </span>
        {isHost && (
          <button
            type="button"
            onClick={endClass}
            disabled={ending}
            className="text-xs font-semibold rounded-full bg-red-500/90 hover:bg-red-500 text-white px-3 py-1.5 transition-colors disabled:opacity-50"
            title="Terminar clase para todos"
          >
            {ending ? "Terminando…" : "Terminar clase"}
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * Fires exactly once when the teacher's client mounts inside the room.
 * Calls the start-recording endpoint; the backend is idempotent so a
 * duplicate call (e.g. if the teacher refreshes) just returns the
 * existing egress id. Failures are non-blocking — the class continues
 * without recording and the teacher sees a small amber pill in the top
 * bar explaining why (useful while Gelfis still hasn't set up S3).
 */
function RecordingAutoStart({ classId }: { classId: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "recording"; egressId: string }
    | { kind: "skipped"; reason: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/aula/${classId}/recording/start`, { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok)                                    setState({ kind: "recording", egressId: data.egress_id });
        else if (data.error === "recording_storage_missing")
                                                       setState({ kind: "skipped",   reason: "storage" });
        else if (data.error === "livekit_not_configured")
                                                       setState({ kind: "skipped",   reason: "livekit" });
        else                                           setState({ kind: "error",     message: data.error ?? "error" });
      } catch (e) {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "network" });
      }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  if (state.kind === "recording") {
    return (
      <div className="pointer-events-none absolute top-16 left-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-red-600/95 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
        REC
      </div>
    );
  }
  if (state.kind === "skipped") {
    return (
      <div
        className="pointer-events-none absolute top-16 left-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-semibold text-amber-950 shadow-lg"
        title={state.reason === "storage"
          ? "Grabación desactivada: el admin aún no ha configurado el almacenamiento S3."
          : "Grabación desactivada: LiveKit no configurado."}
      >
        ⚠ Grabación no disponible
      </div>
    );
  }
  return null;
}

/**
 * When the teacher clicks Leave (or the room ends), bounce them to the
 * end-class confirmation flow.
 */
function HostTeardown({ classId, backHref }: { classId: string; backHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ event: RoomEvent }>;
      if (ev.detail?.event === RoomEvent.Disconnected) {
        router.push(`${backHref}?end=1`);
      }
    };
    window.addEventListener("livekit:disconnected", handler as EventListener);
    return () => window.removeEventListener("livekit:disconnected", handler as EventListener);
  }, [backHref, router, classId]);
  return null;
}

// ───────────────────────────────────────────────────────────────────
// Participants side panel — name, mic status, live "speaking" ring.
// Solves the "student with no camera is invisible in the grid" gap.
// ───────────────────────────────────────────────────────────────────
function ParticipantsPanel({ onClose }: { onClose: () => void }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Sort: local participant first (so you see yourself at the top), then
  // others alphabetically by display name / identity.
  const sorted = useMemo(() => {
    const localId = localParticipant.identity;
    return [...participants].sort((a, b) => {
      if (a.identity === localId) return -1;
      if (b.identity === localId) return 1;
      const an = a.name || a.identity;
      const bn = b.name || b.identity;
      return an.localeCompare(bn);
    });
  }, [participants, localParticipant.identity]);

  return (
    <aside className="w-72 shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100">
          Participantes · <span className="text-slate-400 font-normal">{participants.length}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xl leading-none"
          aria-label="Cerrar panel de participantes"
        >×</button>
      </header>
      <ul className="flex-1 overflow-y-auto">
        {sorted.map(p => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            isMe={p.identity === localParticipant.identity}
          />
        ))}
      </ul>
      <footer className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800">
        El borde naranja señala quién está hablando ahora.
      </footer>
    </aside>
  );
}

function ParticipantRow({
  participant, isMe,
}: { participant: Participant; isMe: boolean }) {
  // isSpeaking + mic-muted state come from LiveKit client events.
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  const [micOn,    setMicOn]    = useState(participant.isMicrophoneEnabled);
  const [camOn,    setCamOn]    = useState(participant.isCameraEnabled);

  useEffect(() => {
    const onSpeakingChange = () => setSpeaking(participant.isSpeaking);
    const onTrackChange    = () => {
      setMicOn(participant.isMicrophoneEnabled);
      setCamOn(participant.isCameraEnabled);
    };
    participant.on(ParticipantEvent.IsSpeakingChanged,   onSpeakingChange);
    participant.on(ParticipantEvent.TrackMuted,          onTrackChange);
    participant.on(ParticipantEvent.TrackUnmuted,        onTrackChange);
    participant.on(ParticipantEvent.TrackPublished,      onTrackChange);
    participant.on(ParticipantEvent.TrackUnpublished,    onTrackChange);
    participant.on(ParticipantEvent.LocalTrackPublished, onTrackChange);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged,   onSpeakingChange);
      participant.off(ParticipantEvent.TrackMuted,          onTrackChange);
      participant.off(ParticipantEvent.TrackUnmuted,        onTrackChange);
      participant.off(ParticipantEvent.TrackPublished,      onTrackChange);
      participant.off(ParticipantEvent.TrackUnpublished,    onTrackChange);
      participant.off(ParticipantEvent.LocalTrackPublished, onTrackChange);
    };
  }, [participant]);

  const name    = participant.name || participant.identity;
  const initial = (name || "?").trim().charAt(0).toUpperCase();

  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/60
                    ${speaking ? "bg-brand-500/10" : "hover:bg-slate-900/60"}`}>
      <div className={`relative h-9 w-9 shrink-0 rounded-full bg-slate-700 flex items-center justify-center font-semibold text-sm text-slate-100
                       ${speaking ? "ring-2 ring-brand-400 ring-offset-2 ring-offset-slate-950" : ""}`}>
        {initial}
        {speaking && (
          <span className="absolute -inset-1 rounded-full border-2 border-brand-400/60 animate-ping" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-100 truncate">
          {name}
          {isMe && <span className="ml-1.5 text-[10px] font-normal text-slate-400">(tú)</span>}
        </div>
        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
          {micOn ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <MicIcon on />
              {speaking ? "hablando" : "mic on"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <MicIcon on={false} />
              mic off
            </span>
          )}
          <span className={camOn ? "text-slate-300" : "text-slate-500"}>
            {camOn ? "📹 cam on" : "📷 sin cam"}
          </span>
        </div>
      </div>
    </li>
  );
}

// ───────────────────────────────────────────────────────────────────
// Chat side panel — wraps LiveKit's <Chat /> component (data-channel
// based, ephemeral; messages disappear when participants disconnect).
// Kept mounted while the room is open so messages keep arriving even
// when the panel is hidden — that's how the unread badge in TopBar
// stays accurate. We just hide it with CSS when `open` is false.
//
// Two bugs fixed in this version:
//   1. Browser was offering credit-card autofill in the chat input
//      because <Chat /> doesn't ship autocomplete/autocorrect attrs.
//      We patch them onto the rendered input via a ref-effect.
//   2. The message list was clipping at the top because LiveKit's
//      default `.lk-chat-messages` doesn't always inherit the flex
//      sizing of an arbitrary wrapper. Inline overrides force the
//      message list to fill available height and scroll correctly.
// ───────────────────────────────────────────────────────────────────
function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root) return;

    // Suppress the browser's credit-card / password autofill heuristics
    // on the chat input. Multiple attributes because different browsers
    // honour different ones; doing all of them is the safe play.
    const apply = () => {
      const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea, [contenteditable]"
      );
      if (!input) return false;
      input.setAttribute("autocomplete",   "off");
      input.setAttribute("autocorrect",    "off");
      input.setAttribute("autocapitalize", "sentences");
      input.setAttribute("spellcheck",     "true");
      input.setAttribute("name",           "lk-chat-message");
      // Chrome / Edge ignore autocomplete=off for fields it considers
      // "personal data". data-form-type=other is the documented escape.
      input.setAttribute("data-form-type", "other");
      input.setAttribute("data-lpignore",  "true");
      input.setAttribute("data-1p-ignore", "true");
      return true;
    };
    if (!apply()) {
      // <Chat /> mounts the form async; observe and apply once it shows.
      const obs = new MutationObserver(() => { if (apply()) obs.disconnect(); });
      obs.observe(root, { childList: true, subtree: true });
      return () => obs.disconnect();
    }
  }, []);

  return (
    <aside
      className={`absolute right-0 top-0 bottom-0 z-20 w-80 max-w-[85vw]
                  border-l border-slate-800 bg-slate-950/90 backdrop-blur-sm
                  shadow-2xl flex flex-col ${open ? "" : "hidden"}`}
      aria-hidden={!open}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <h2 className="text-sm font-semibold text-slate-100">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xl leading-none"
          aria-label="Cerrar chat"
        >×</button>
      </header>

      {/* LiveKit's prebuilt Chat handles its own message list + input.
          We force it into a flex column that fills the panel and a
          messages list that actually scrolls — without these overrides
          the message list grows past its parent and clips at the top. */}
      <div
        ref={wrapperRef}
        className="flex-1 min-h-0 flex flex-col
                   [&_.lk-chat]:flex-1
                   [&_.lk-chat]:min-h-0
                   [&_.lk-chat]:flex
                   [&_.lk-chat]:flex-col
                   [&_.lk-chat]:overflow-hidden
                   [&_.lk-chat-messages]:flex-1
                   [&_.lk-chat-messages]:min-h-0
                   [&_.lk-chat-messages]:overflow-y-auto
                   [&_.lk-chat-form]:shrink-0"
      >
        <Chat />
      </div>
    </aside>
  );
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {!on && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────
// Helpers + loading / error screens
// ───────────────────────────────────────────────────────────────────
function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function LoadingScreen({ classTitle }: { classTitle: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-md text-center">
        <div className="inline-block h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold">{classTitle}</h1>
        <p className="mt-1 text-xs text-slate-400">Conectando al aula…</p>

        {/* Permission prompt — fires the moment LiveKit calls
            getUserMedia. Most leads who fail to join do so by clicking
            "Bloquear" by reflex; surfacing it here primes them for
            the right answer. */}
        <div className="mt-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-left">
          <p className="text-sm text-amber-100 leading-relaxed">
            <strong className="font-semibold">🎤📹 Tu navegador te pedirá permiso</strong> para usar el
            <strong> micrófono</strong> y la <strong>cámara</strong>.
            <br />
            Pulsa <strong>“Permitir”</strong> — sin eso el profesor no podrá
            oírte ni verte.
          </p>
        </div>
      </div>
    </main>
  );
}

/**
 * Pre-join screen — preview de cámara + micro + selector de
 * dispositivos antes de conectar al aula. Igual que el "Listo para
 * unirte" de Google Meet. Se muestra una vez (mientras `userChoices`
 * en el padre sea null).
 *
 * Usa `<PreJoin>` de @livekit/components-react que ya cubre:
 *  - preview de cámara
 *  - meter de nivel del micrófono
 *  - selector de cámara/mic/altavoz
 *  - toggles para entrar con cam/mic apagado
 *  - manejo de "No hay dispositivo" / "Permisos denegados"
 *
 * Lo wrapeamos en nuestro chrome (header con título de la clase +
 * link "volver") y dejamos `data-lk-theme="default"` para que el
 * styling oscuro de @livekit/components-styles aplique.
 */
function AulaPreJoin({
  classTitle, defaultName, backHref, onSubmit, onError,
  background, onBackgroundChange, brandEnabled,
}: {
  classTitle:  string;
  defaultName: string;
  backHref:    string;
  onSubmit:    (choices: LocalUserChoices) => void;
  onError?:    (e: Error) => void;
  background:  BgMode;
  onBackgroundChange: (m: BgMode) => void;
  brandEnabled?: boolean;
}) {
  const bgOptions: BgMode[] = brandEnabled
    ? ["off", "blur", "azul", "calido", "verde"]
    : ["off", "blur"];
  return (
    <main
      data-lk-theme="default"
      className="min-h-screen w-full flex flex-col bg-slate-950 text-slate-100"
    >
      {/* Header propio — mantiene la marca aunque PreJoin sea un
          componente externo. */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80">
        <Link
          href={backHref}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full
                     hover:bg-white/10 active:scale-95 transition text-slate-300"
          aria-label="Volver"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor"
               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Aprender-Aleman.de
          </div>
          <div className="text-sm font-semibold truncate">{classTitle}</div>
        </div>
      </header>

      {/* Cuerpo: PreJoin centrado. max-width para que en desktop no
          se estire indefinidamente. */}
      <div className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-3xl">
          <h1 className="text-xl sm:text-2xl font-bold text-center mb-1">
            Listo para unirte
          </h1>
          <p className="text-center text-sm text-slate-400 mb-6">
            Comprueba tu cámara y micrófono antes de entrar.
          </p>
          <PreJoin
            defaults={{
              username:      defaultName,
              videoEnabled:  true,
              audioEnabled:  true,
            }}
            onSubmit={onSubmit}
            onError={onError}
            joinLabel="Unirme a la clase"
            micLabel="Micrófono"
            camLabel="Cámara"
            userLabel="Tu nombre"
            persistUserChoices={false}
          />

          {/* Selector de fondo virtual — se aplica automáticamente al
              entrar. La preview del PreJoin no lo muestra en vivo
              (limitación del componente); las miniaturas enseñan el
              diseño. */}
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 text-center mb-2">
              Fondo virtual
            </div>
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              {bgOptions.map((m) => {
                const active = background === m;
                const isImage = m !== "off" && m !== "blur";
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onBackgroundChange(m)}
                    className={`group flex flex-col items-center gap-1.5 focus:outline-none`}
                    title={BG_LABELS[m]}
                  >
                    <span
                      className={`block w-20 h-12 rounded-lg overflow-hidden border-2 transition bg-cover bg-center
                                  ${active ? "border-warm shadow-md shadow-warm/25" : "border-slate-700 group-hover:border-slate-500"}`}
                      style={isImage
                        ? { backgroundImage: `url(${BRAND_IMAGES[m as keyof typeof BRAND_IMAGES]})` }
                        : undefined}
                    >
                      {m === "off" && (
                        <span className="flex items-center justify-center w-full h-full bg-slate-800 text-slate-400 text-[10px]">
                          Ninguno
                        </span>
                      )}
                      {m === "blur" && (
                        <span className="flex items-center justify-center w-full h-full text-slate-300 text-[10px]
                                         bg-[linear-gradient(120deg,#334155_0%,#475569_40%,#334155_100%)] blur-[0.3px]">
                          Difuminado
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] ${active ? "text-warm font-semibold" : "text-slate-400"}`}>
                      {BG_LABELS[m]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ErrorScreen({ reason, backHref, onRetry }: {
  reason: string; backHref: string; onRetry?: () => void;
}) {
  // "Client initiated disconnect" es un error de LiveKit típico
  // cuando la conexión se aborta en pleno handshake — casi siempre
  // porque el navegador (iOS Safari) tenía la cámara/mic ocupada
  // desde el PreJoin. Con el handoff de 400 ms lo mitigamos, pero
  // si vuelve a pasar guiamos al usuario a reintentar o cambiar de
  // red antes que se rinda.
  const isClientDisconnect = /client initiated disconnect/i.test(reason);
  const isMediaError       = /permission|notallowed|notfound|constraint/i.test(reason);

  const label =
    reason === "not_configured"        ? "La sala de video aún no está configurada en el servidor." :
    reason === "too_early_or_too_late" ? "El aula no está abierta ahora." :
    reason === "not_authorized"        ? "No tienes acceso a esta clase." :
    reason === "cancelled"             ? "Esta clase fue cancelada." :
    isClientDisconnect                 ? "La conexión se interrumpió antes de completarse. Suele pasar en iPhone si la app estuvo en segundo plano o si el navegador tardó en soltar la cámara. Pulsa 'Reintentar'." :
    isMediaError                       ? "No pudimos usar la cámara o el micrófono. Comprueba los permisos y reintenta." :
                                         `No se pudo conectar (${reason}).`;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>⚠️</div>
        <h1 className="text-xl font-semibold">Error al entrar al aula</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">{label}</p>
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-primary inline-flex"
            >
              Reintentar
            </button>
          )}
          <Link
            href={backHref}
            className={`inline-flex px-4 py-2 rounded-2xl font-semibold text-sm transition ${
              onRetry
                ? "border border-slate-700 text-slate-300 hover:bg-slate-800"
                : "btn-primary"
            }`}
          >
            Volver
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * Interstitial cuando detectamos in-app WebView (WhatsApp/IG/FB/Gmail
 * app). WebRTC no funciona ahí — sacamos al lead a Safari/Chrome ANTES
 * de que ni siquiera intente PreJoin, para no darle un error críptico
 * de LiveKit tras 30 s de spinner.
 */
function WebViewBlockerScreen({
  classTitle, onIgnore,
}: { classTitle: string; onIgnore: () => void }) {
  const [copied, setCopied] = useState(false);
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";
  const iOS = isIOS();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: prompt en pantalla para copiar manual
      window.prompt("Copia el enlace y pégalo en Safari/Chrome:", currentUrl);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>🌐</div>
        <h1 className="text-xl font-semibold">Abre en tu navegador</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Estás usando el navegador integrado de una app (WhatsApp, Instagram, Gmail…). No soporta videollamadas.
        </p>
        <p className="mt-3 text-sm text-slate-300 leading-relaxed">
          <strong>Copia el enlace y ábrelo en {iOS ? "Safari" : "Chrome"}</strong> para unirte a tu clase.
        </p>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={copyLink}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm active:scale-[0.98] transition"
          >
            {copied ? "✓ Copiado" : "📋 Copiar enlace"}
          </button>
          {iOS && (
            <p className="text-[11.5px] text-slate-500 leading-snug pt-1">
              iPhone: pulsa <strong>·••</strong> arriba a la derecha → <strong>&ldquo;Abrir en Safari&rdquo;</strong>. O pega el enlace copiado en Safari.
            </p>
          )}
          {!iOS && (
            <p className="text-[11.5px] text-slate-500 leading-snug pt-1">
              Android: pulsa el menú <strong>·••</strong> → <strong>&ldquo;Abrir en navegador&rdquo;</strong>. O pega el enlace copiado en Chrome.
            </p>
          )}
        </div>

        <p className="mt-5 text-[11px] text-slate-600">{classTitle}</p>

        <button
          type="button"
          onClick={onIgnore}
          className="mt-5 text-[11.5px] text-slate-500 underline underline-offset-4 hover:text-slate-300"
        >
          Continuar de todos modos (puede no funcionar)
        </button>
      </div>
    </main>
  );
}

/** Pantalla de transición entre PreJoin y LiveKitRoom — evita
 *  parpadeo negro mientras iOS suelta la cámara. */
function HandoffScreen({ classTitle }: { classTitle: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5">
      <div className="text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <div className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
        </div>
        <p className="mt-3 text-sm text-slate-300 font-semibold">Conectando…</p>
        <p className="mt-1 text-[11.5px] text-slate-500">{classTitle}</p>
      </div>
    </main>
  );
}

/** Timer no-visual — separado para poder ponerlo dentro/fuera del árbol
 *  sin re-crearlo. */
function HandoffTimer({ onReady, delayMs = 400 }: { onReady: () => void; delayMs?: number }) {
  useEffect(() => {
    const t = setTimeout(onReady, delayMs);
    return () => clearTimeout(t);
  }, [onReady, delayMs]);
  return null;
}
