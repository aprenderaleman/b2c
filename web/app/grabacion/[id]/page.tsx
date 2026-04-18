import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { canViewRecording } from "@/lib/aula";
import { formatBytes, formatDurationHms, getRecordingById } from "@/lib/recordings";
import { getClassById, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grabación · Aprender-Aleman.de" };

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["superadmin", "admin", "teacher", "student"]);
  const { id } = await params;

  const rec = await getRecordingById(id);
  if (!rec) notFound();

  const access = await canViewRecording(id, session.user.id, session.user.role);
  if (!access.ok) redirect("/");

  const cls = await getClassById(rec.class_id);
  if (!cls) notFound();

  const backHref =
    session.user.role === "student" ? `/estudiante/clases/${cls.id}` :
    session.user.role === "teacher" ? `/profesor/clases/${cls.id}`   :
                                      `/admin/clases/${cls.id}`;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 bg-slate-900 border-b border-slate-800">
        <Link href={backHref} className="text-sm text-slate-400 hover:text-brand-400">
          ← Volver a la clase
        </Link>
        <div className="text-xs text-slate-400 truncate max-w-xs sm:max-w-md">
          {cls.title} · <span className="capitalize">{formatClassDateEs(cls.scheduled_at)}</span> · {formatClassTimeEs(cls.scheduled_at)}
        </div>
        <div className="w-10" />
      </header>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-5">
        {rec.status === "processing" && (
          <StatusBlock emoji="⏳" title="Procesando la grabación…" body="El vídeo se está transcodificando. Normalmente tarda 1–2 veces la duración de la clase." />
        )}
        {rec.status === "failed" && (
          <StatusBlock
            emoji="⚠️"
            tone="error"
            title="La grabación falló"
            body={rec.error ?? "No se pudo procesar el vídeo. Avisa al equipo para investigarlo."}
          />
        )}

        {rec.status === "ready" && rec.file_url && (
          <div className="rounded-2xl overflow-hidden bg-black ring-1 ring-slate-800">
            <video
              src={rec.file_url}
              controls
              playsInline
              preload="metadata"
              className="w-full h-auto max-h-[80vh] bg-black"
            />
          </div>
        )}

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Detalles
          </h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
            <Row k="Clase"     v={cls.title} />
            <Row k="Fecha"     v={`${formatClassDateEs(cls.scheduled_at)} · ${formatClassTimeEs(cls.scheduled_at)} (Berlín)`} />
            <Row k="Duración"  v={rec.duration_seconds ? formatDurationHms(rec.duration_seconds) : "—"} />
            <Row k="Tamaño"    v={formatBytes(rec.file_size_bytes)} />
            <Row k="Procesada" v={rec.processed_at ? new Date(rec.processed_at).toLocaleString("es-ES") : "—"} />
            <Row k="Descarga"  v={rec.downloadable ? "Permitida" : "Sólo reproducción"} />
          </dl>
          {rec.status === "ready" && rec.file_url && rec.downloadable && (
            <a
              href={rec.file_url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="btn-secondary mt-4 inline-flex text-sm"
            >
              Descargar vídeo
            </a>
          )}
        </section>
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 pb-1">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-slate-100 text-right break-all">{v}</dd>
    </div>
  );
}

function StatusBlock({ emoji, title, body, tone }: {
  emoji: string; title: string; body: string; tone?: "error";
}) {
  const cls = tone === "error"
    ? "border-red-500/30 bg-red-500/10"
    : "border-slate-700 bg-slate-900";
  return (
    <div className={`rounded-2xl border ${cls} p-6 text-center`}>
      <div className="text-4xl" aria-hidden>{emoji}</div>
      <h2 className="mt-2 text-lg font-semibold text-slate-50">{title}</h2>
      <p className="mt-1 text-sm text-slate-300">{body}</p>
    </div>
  );
}
