"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Acuerdo de Colaboración del closer — acciones admin (2026-11-27).
 * Mismo flujo que el de profesores: Ver PDF · Firmar (firma guardada o
 * dibujada) · (Re)enviar por email · Marcar firmado recibido.
 */
export function CloserAgreementActions({ closerId, sent, signedAt, receivedAt }: {
  closerId: string; sent: boolean; signedAt?: string | null; receivedAt?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);

  const markReceived = async () => {
    if (!confirm("¿Confirmas que el closer devolvió el acuerdo firmado?")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/closers/${closerId}/agreement/received`, { method: "POST" });
      setMsg(res.ok ? "Registrado ✓" : `Error ${res.status}`);
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!confirm(`${sent ? "Reenviar" : "Enviar"} el Acuerdo de Colaboración por email al closer?`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/closers/${closerId}/agreement`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? "Enviado ✓" : `Error: ${d.error ?? res.status}`);
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <a href={`/api/admin/closers/${closerId}/agreement`} target="_blank" rel="noopener noreferrer"
         className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
        Ver PDF
      </a>
      <button type="button" onClick={() => setSignOpen(true)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
        {signedAt ? "✍️ Ver / volver a firmar" : "✍️ Firmar acuerdo"}
      </button>
      <button type="button" onClick={send} disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1.5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
        {busy ? "Enviando…" : sent ? "Reenviar por email" : "Enviar por email"}
      </button>
      {receivedAt
        ? <span className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">Firmado por el closer ✓ {new Date(receivedAt).toLocaleDateString("es-ES")}</span>
        : <button type="button" onClick={markReceived} disabled={busy} className="rounded-lg border border-emerald-300 px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 disabled:opacity-60">Acuerdo firmado recibido</button>}
      {msg && <span className="text-slate-500">{msg}</span>}
      {signOpen && <SignModal closerId={closerId} onClose={() => setSignOpen(false)} />}
    </div>
  );
}

function SignModal({ closerId, onClose }: { closerId: string; onClose: () => void }) {
  const router = useRouter();
  const [hasSaved, setHasSaved] = useState<boolean | null>(null);
  const [mode, setMode]         = useState<"saved" | "draw">("saved");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [done, setDone]         = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing   = useRef(false);
  const hasInk    = useRef(false);

  const previewUrl = `/api/admin/closers/${closerId}/agreement?draft=1&t=${Date.now()}`;

  useEffect(() => {
    fetch("/api/admin/signature", { cache: "no-store" })
      .then(r => { setHasSaved(r.ok); if (!r.ok) setMode("draw"); })
      .catch(() => { setHasSaved(false); setMode("draw"); });
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasInk.current = true;
  };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); hasInk.current = false; };

  const sign = async () => {
    setErr(null);
    let dataUrl: string | undefined;
    if (mode === "draw") {
      if (!hasInk.current) { setErr("Dibuja tu firma en el recuadro."); return; }
      dataUrl = canvasRef.current!.toDataURL("image/png");
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/closers/${closerId}/agreement/sign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.message ?? d.error ?? "No se pudo firmar."); return; }
      setDone(true);
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-6xl h-[92vh] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">Firmar Acuerdo de Colaboración</h3>
            <p className="text-xs text-slate-500">Revisa el PDF, confirma la firma y guarda. Los reenvíos y las próximas altas llevarán la versión firmada.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cerrar</button>
        </div>

        <div className="flex-1 grid md:grid-cols-[1fr_340px] min-h-0">
          <iframe title="Acuerdo" src={previewUrl} className="w-full h-full min-h-[360px] bg-slate-100" />

          <div className="border-l border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-3 overflow-y-auto">
            {done ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                <p className="font-semibold">✓ Acuerdo firmado y guardado</p>
                <a href={`/api/admin/closers/${closerId}/agreement?t=${Date.now()}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs underline">Ver PDF firmado</a>
                <div className="mt-3"><button type="button" onClick={onClose} className="btn-primary text-sm">Listo</button></div>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tu firma</p>
                {hasSaved === null && <p className="text-xs text-slate-400">Cargando…</p>}
                {hasSaved && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="sigmode" checked={mode === "saved"} onChange={() => setMode("saved")} className="mt-1" />
                    <span>
                      Usar mi firma guardada
                      <img src={`/api/admin/signature?t=${Date.now()}`} alt="Firma guardada" className="mt-1 h-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white object-contain px-2" />
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="sigmode" checked={mode === "draw"} onChange={() => setMode("draw")} className="mt-1" />
                  <span>{hasSaved ? "Dibujar una firma nueva (sustituye a la guardada)" : "Dibuja tu firma"}</span>
                </label>
                {mode === "draw" && (
                  <div>
                    <canvas
                      ref={canvasRef} width={640} height={220}
                      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
                      className="w-full h-40 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white touch-none cursor-crosshair"
                    />
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Firma con el ratón, el dedo o el lápiz.</span>
                      <button type="button" onClick={clear} className="underline">Borrar</button>
                    </div>
                  </div>
                )}
                {err && <p className="text-sm text-red-600">{err}</p>}
                <button type="button" onClick={sign} disabled={busy || hasSaved === null}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 disabled:opacity-60">
                  {busy ? "Firmando…" : "✍️ Firmar y guardar"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
