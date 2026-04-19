"use client";

import { useCallback, useEffect, useState } from "react";
import { useDataChannel, useLocalParticipant } from "@livekit/components-react";

/**
 * Quick-reaction emojis for the live classroom. Uses LiveKit's data
 * channel to broadcast to every other participant. Everyone (including
 * the sender) sees a big emoji bubble up from the bottom-right for ~2s.
 *
 * Zero server state — reactions are ephemeral by design.
 */
const REACTIONS = ["👍", "❤️", "😂", "😕", "❓"] as const;
type Reaction = typeof REACTIONS[number];

type Bubble = { id: number; emoji: string; offset: number };

export function Reactions() {
  const { localParticipant } = useLocalParticipant();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  // Send a reaction over the data channel (topic "reactions").
  const send = useCallback((emoji: Reaction) => {
    const payload = JSON.stringify({ t: "reaction", emoji });
    const encoder = new TextEncoder();
    localParticipant.publishData(encoder.encode(payload), {
      topic: "reactions",
      reliable: false,
    }).catch(() => {});
    spawn(emoji);
  }, [localParticipant]);

  const spawn = useCallback((emoji: string) => {
    const id = Math.random();
    setBubbles(b => [...b, { id, emoji, offset: Math.random() * 60 - 30 }]);
    setTimeout(() => setBubbles(b => b.filter(x => x.id !== id)), 2400);
  }, []);

  // Listen for reactions from OTHERS (and echo our own — simpler UX).
  useDataChannel("reactions", (msg) => {
    try {
      const body = JSON.parse(new TextDecoder().decode(msg.payload)) as { t?: string; emoji?: string };
      if (body.t === "reaction" && typeof body.emoji === "string") {
        // Skip our own — we already spawned locally when sending.
        if (msg.from?.identity === localParticipant.identity) return;
        spawn(body.emoji);
      }
    } catch { /* ignore malformed */ }
  });

  return (
    <>
      {/* Reaction toolbar — sits above the LiveKit ControlBar */}
      <div className="pointer-events-auto absolute bottom-20 right-4 z-30 flex gap-1.5 rounded-full bg-slate-800/90 backdrop-blur px-2 py-1 shadow-lg">
        {REACTIONS.map(e => (
          <button
            key={e}
            type="button"
            onClick={() => send(e)}
            className="h-9 w-9 inline-flex items-center justify-center text-xl rounded-full hover:bg-slate-700 transition-colors"
            title={`Enviar ${e}`}
            aria-label={`Enviar reacción ${e}`}
          >
            {e}
          </button>
        ))}
      </div>

      {/* Floating bubbles */}
      <div className="pointer-events-none absolute bottom-20 right-20 z-40">
        {bubbles.map(b => (
          <span
            key={b.id}
            className="absolute text-4xl select-none"
            style={{
              right: `${b.offset + 40}px`,
              animation: "reactionFloat 2.4s ease-out forwards",
            }}
            aria-hidden
          >
            {b.emoji}
          </span>
        ))}
      </div>

      {/* Keyframes injected via a tiny style tag — no need to touch the
          global CSS. */}
      <style jsx global>{`
        @keyframes reactionFloat {
          0%   { transform: translateY(0)      scale(0.85); opacity: 0;   }
          15%  { transform: translateY(-20px)  scale(1.1);  opacity: 1;   }
          80%  { transform: translateY(-160px) scale(1);    opacity: 0.9; }
          100% { transform: translateY(-220px) scale(0.9);  opacity: 0;   }
        }
      `}</style>
    </>
  );
}
