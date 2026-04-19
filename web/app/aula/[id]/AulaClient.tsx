"use client";

import "@livekit/components-styles";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  ControlBar,
  GridLayout,
  FocusLayout,
  FocusLayoutContainer,
  CarouselLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useParticipants,
  useLocalParticipant,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { RoomEvent, Track, type Participant } from "livekit-client";

type Props = {
  classId:          string;
  classTitle:       string;
  scheduledAt:      string;
  durationMinutes:  number;
  isHost:           boolean;
  displayName:      string;
  backHref:         string;
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
export function AulaClient(p: Props) {
  const [token, setToken]         = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

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

  if (error) return <ErrorScreen reason={error} backHref={p.backHref} />;
  if (!token || !serverUrl) return <LoadingScreen classTitle={p.classTitle} />;

  return (
    <main className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        video={true}
        audio={true}
        data-lk-theme="default"
        onError={(e) => setError(e.message)}
        onDisconnected={() => { /* keep state, user can reconnect */ }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TopBar
          classId={p.classId}
          title={p.classTitle}
          scheduledAt={p.scheduledAt}
          durationMinutes={p.durationMinutes}
          isHost={p.isHost}
          backHref={p.backHref}
        />
        <div className="flex-1 min-h-0 bg-slate-900">
          <VideoArea classId={p.classId} isHost={p.isHost} />
        </div>
        <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-2">
          <ControlBar
            controls={{
              microphone: true,
              camera:     true,
              screenShare: true,   // enabled for everyone — students can share too
              chat:       false,    // Phase 4
              leave:      true,
            }}
          />
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
// Top bar + teacher "end class" button + teardown hook
// ───────────────────────────────────────────────────────────────────
function TopBar({ classId, title, scheduledAt, durationMinutes, isHost, backHref }: {
  classId: string; title: string; scheduledAt: string; durationMinutes: number;
  isHost: boolean; backHref: string;
}) {
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

  const endClass = async () => {
    if (!confirm("¿Terminar clase para TODOS? Se desconectarán profesor y estudiantes.")) return;
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
// Helpers + loading / error screens
// ───────────────────────────────────────────────────────────────────
function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function LoadingScreen({ classTitle }: { classTitle: string }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold">{classTitle}</h1>
        <p className="mt-1 text-xs text-slate-400">Conectando al aula…</p>
      </div>
    </main>
  );
}

function ErrorScreen({ reason, backHref }: { reason: string; backHref: string }) {
  const label =
    reason === "not_configured"        ? "La sala de video aún no está configurada en el servidor." :
    reason === "too_early_or_too_late" ? "El aula no está abierta ahora." :
    reason === "not_authorized"        ? "No tienes acceso a esta clase." :
    reason === "cancelled"             ? "Esta clase fue cancelada." :
                                         `No se pudo conectar (${reason}).`;
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-5">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4" aria-hidden>⚠️</div>
        <h1 className="text-xl font-semibold">Error al entrar al aula</h1>
        <p className="mt-2 text-sm text-slate-400">{label}</p>
        <Link href={backHref} className="btn-primary mt-6 inline-flex">Volver</Link>
      </div>
    </main>
  );
}
