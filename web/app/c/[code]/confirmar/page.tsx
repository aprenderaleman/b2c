import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { formatBerlinFull } from "@/lib/time";
import { confirmAttendanceAction } from "./actions";

/**
 * GET /c/{code}/confirmar — página pública donde el lead confirma su
 * asistencia a la clase. Recibe el enlace por WhatsApp/email del setter
 * tras un "No contestó". Cuando confirma, el profe ve en su panel
 * "✅ Lead confirmó por WhatsApp a las HH:MM" (Gelfis 2026-11-14).
 *
 * UX: el lead abre el enlace → ve los detalles (fecha + profe) → pulsa
 * un botón grande "Confirmar mi asistencia" → ve el gracias. Idempotente:
 * si vuelve a abrir el enlace después de confirmar, ve "ya confirmaste".
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ConfirmarPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!code || code.length < 4 || code.length > 32) notFound();

  const sb = supabaseAdmin();
  const { data: clsRow } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, status, is_trial, duration_minutes,
      student_confirmed_at, student_confirmed_source,
      lead_id,
      leads:lead_id ( name, language )
    `)
    .eq("short_code", code)
    .maybeSingle();

  const cls = clsRow as {
    id: string;
    scheduled_at: string;
    status: string;
    is_trial: boolean;
    duration_minutes: number | null;
    student_confirmed_at: string | null;
    student_confirmed_source: string | null;
    lead_id: string | null;
    leads: { name: string | null; language: "es" | "de" | null } | null;
  } | null;

  if (!cls || !cls.lead_id) notFound();

  const firstName = (cls.leads?.name ?? "").trim().split(/\s+/)[0] || "";
  const lang = (cls.leads?.language === "de" ? "de" : "es") as "es" | "de";
  const startLabel = formatBerlinFull(cls.scheduled_at, lang);
  const alreadyConfirmed = !!cls.student_confirmed_at;
  const cancelled = cls.status === "cancelled";

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:py-16">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 sm:p-8">
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          {cancelled
            ? "Tu clase fue cancelada"
            : alreadyConfirmed
            ? "¡Ya está! Asistencia confirmada ✅"
            : "¿Confirmas tu clase?"}
        </h1>

        {cancelled ? (
          <p className="text-slate-700">
            Hola {firstName} — esta clase ya no está activa. Escríbenos a <a className="text-emerald-700 underline" href="mailto:aprenderaleman2026@gmail.com">aprenderaleman2026@gmail.com</a> y te buscamos un nuevo horario.
          </p>
        ) : alreadyConfirmed ? (
          <>
            <p className="text-slate-700 mb-4">
              Gracias {firstName} 🙌 Tu profe ya sabe que vas a asistir.
            </p>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
              <div><b>📅 Cuándo:</b> {startLabel}</div>
              <div className="mt-1"><b>⏱ Duración:</b> {cls.duration_minutes ?? 40} minutos</div>
              <div className="mt-3">
                <b>🔗 Entrarás aquí el día de la clase:</b><br />
                <a className="text-emerald-700 underline break-all" href={`/c/${code}`}>b2c.aprender-aleman.de/c/{code}</a>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-4">
              Un tip: ten papel y lápiz a mano para apuntar el plan que te prepare tu profe.
            </p>
          </>
        ) : (
          <>
            <p className="text-slate-700 mb-4">
              Hola {firstName} 👋 — confirma con un clic que te vas a conectar. Así tu profe reserva los 40 minutos para prepararte el plan.
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-800 mb-5">
              <div><b>📅 Cuándo:</b> {startLabel}</div>
              <div className="mt-1"><b>⏱ Duración:</b> {cls.duration_minutes ?? 40} minutos (1 a 1 con profe nativo)</div>
            </div>

            <form action={confirmAttendanceAction}>
              <input type="hidden" name="code" value={code} />
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 text-base"
              >
                ✅ Sí, voy a asistir
              </button>
            </form>

            <p className="text-xs text-slate-500 mt-4 text-center">
              ¿No puedes a esa hora? Responde al WhatsApp o escribe a <a className="underline" href="mailto:aprenderaleman2026@gmail.com">aprenderaleman2026@gmail.com</a>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
