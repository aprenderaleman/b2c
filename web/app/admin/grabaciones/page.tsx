import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { formatBytes, formatDurationHms } from "@/lib/recordings";
import { RecordingRow } from "./RecordingRow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grabaciones · Admin" };

/**
 * Centralised admin view of every class recording.
 * Default order: newest first. 50 per page is fine for now; pagination
 * can come later if we accumulate thousands.
 */
export default async function AdminRecordingsPage() {
  await requireRole(["admin", "superadmin"]);

  const sb = supabaseAdmin();
  const { data: rows } = await sb
    .from("recordings")
    .select(`
      id, status, duration_seconds, file_size_bytes, created_at, processed_at,
      class:classes!inner(
        id, title, scheduled_at,
        teacher:teachers!inner(
          users!inner(full_name, email)
        ),
        class_participants(
          students!inner(users!inner(full_name, email))
        )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  type UserLite = { full_name: string | null; email: string };
  type ClassShape = {
    id:           string;
    title:        string | null;
    scheduled_at: string | null;
    teacher: {
      users: UserLite | UserLite[];
    } | Array<{ users: UserLite | UserLite[] }>;
    class_participants: Array<{
      students: { users: UserLite | UserLite[] } |
                Array<{ users: UserLite | UserLite[] }>;
    }>;
  };
  type Row = {
    id:               string;
    status:           "processing" | "ready" | "failed";
    duration_seconds: number | null;
    file_size_bytes:  number | null;
    created_at:       string;
    processed_at:     string | null;
    class: ClassShape | ClassShape[];
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? (x[0] ?? null) : x;

  const items = ((rows ?? []) as Row[]).map(r => {
    const c  = flat(r.class);
    const t  = c ? flat(c.teacher) : null;
    const tu = t ? flat(t.users) : null;
    const students = c?.class_participants?.map(p => {
      const s = flat(p.students);
      return s ? flat(s.users) : null;
    }).filter(Boolean) as UserLite[] ?? [];

    return {
      recording_id: r.id,
      status:       r.status,
      duration:     r.duration_seconds,
      size:         r.file_size_bytes,
      created_at:   r.created_at,
      class_id:     c?.id ?? null,
      class_title:  c?.title ?? "(sin título)",
      class_date:   c?.scheduled_at ?? r.created_at,
      teacher_name: tu?.full_name || tu?.email || "—",
      students,
    };
  });

  // Aggregate counters for the header summary.
  const ready      = items.filter(i => i.status === "ready").length;
  const processing = items.filter(i => i.status === "processing").length;
  const failed     = items.filter(i => i.status === "failed").length;

  return (
    <main className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Grabaciones</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Últimas 50 clases grabadas, las más recientes primero.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Chip tone="emerald" label={`${ready} listas`} />
          {processing > 0 && <Chip tone="amber"  label={`${processing} procesando`} />}
          {failed > 0     && <Chip tone="red"    label={`${failed} con error`}     />}
          <Link
            href="/admin/mantenimiento"
            className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600"
          >
            Mantenimiento →
          </Link>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
            Aún no hay grabaciones. Cuando se termine una clase en el aula, aparecerá aquí.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map(it => (
              <RecordingRow
                key={it.recording_id}
                item={{
                  recording_id:   it.recording_id,
                  status:         it.status,
                  class_id:       it.class_id,
                  class_title:    it.class_title,
                  teacher_name:   it.teacher_name,
                  student_names:  it.students.map(s => (s.full_name || s.email).split(/\s+/)[0]),
                  duration_label: it.duration ? formatDurationHms(it.duration) : "—",
                  size_label:     formatBytes(it.size),
                  date_label:     fmtDate(it.class_date),
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Chip({ tone, label }: {
  tone: "emerald" | "amber" | "red"; label: string;
}) {
  const cls = tone === "emerald" ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" :
              tone === "amber"   ? "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   :
                                   "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium ${cls}`}>
      {label}
    </span>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      timeZone: "Europe/Berlin",
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}
