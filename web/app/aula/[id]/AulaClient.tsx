"use client";

import "@livekit/components-styles";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  ControlBar,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";

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
 */
export function AulaClient(p: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <TopBar
        title={p.classTitle}
        scheduledAt={p.scheduledAt}
        durationMinutes={p.durationMinutes}
        isHost={p.isHost}
        backHref={p.backHref}
      />

      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        video={true}
        audio={true}
        data-lk-theme="default"
        onError={(e) => setError(e.message)}
        onDisconnected={() => { /* keep state, user can reconnect */ }}
        className="flex-1 min-h-0"
      >
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0 bg-slate-900">
            <VideoGrid />
          </div>
          <div className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-2">
            <ControlBar
              controls={{
                microphone: true,
                camera:     true,
                screenShare: true,
                chat:       false,    // Phase 4
                leave:      true,
              }}
            />
          </div>
        </div>
        <RoomAudioRenderer />
        {p.isHost && <HostTeardown classId={p.classId} backHref={p.backHref} />}
      </LiveKitRoom>
    </main>
  );
}

function VideoGrid() {
  // Pulls every published camera or screen-share track and renders
  // them as tiles. Fallback to audio-only avatars handled by
  // ParticipantTile automatically.
  const tracks = useTracks(
    [
      { source: Track.Source.Camera,       withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

/**
 * When the teacher clicks Leave, bounce them to the end-class modal
 * (class detail → confirms actual duration). The LiveKit ControlBar's
 * leave button fires a custom event we subscribe to here.
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
// Top bar + fallbacks
// ───────────────────────────────────────────────────────────────────

function TopBar({ title, scheduledAt, durationMinutes, isHost, backHref }: {
  title: string; scheduledAt: string; durationMinutes: number;
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
      </div>
    </header>
  );
}

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
