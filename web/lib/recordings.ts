import { supabaseAdmin } from "./supabase";

export type RecordingStatus = "processing" | "ready" | "failed";

export type RecordingRow = {
  id:                string;
  class_id:          string;
  file_url:          string | null;
  file_size_bytes:   number | null;
  duration_seconds:  number | null;
  status:            RecordingStatus;
  error:             string | null;
  downloadable:      boolean;
  created_at:        string;
  processed_at:      string | null;
};

export async function getRecordingById(id: string): Promise<RecordingRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("recordings")
    .select("id, class_id, file_url, file_size_bytes, duration_seconds, status, error, downloadable, created_at, processed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as RecordingRow | null) ?? null;
}

export async function getRecordingsForClass(classId: string): Promise<RecordingRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("recordings")
    .select("id, class_id, file_url, file_size_bytes, duration_seconds, status, error, downloadable, created_at, processed_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as RecordingRow[];
}

/**
 * "Recordings the student has access to" — every recording attached to a
 * class where they appeared in class_participants.
 */
export async function getStudentRecordings(studentId: string): Promise<
  Array<RecordingRow & { class_title: string; scheduled_at: string }>
> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("class_participants")
    .select(`
      class:classes!inner(
        id, title, scheduled_at,
        recordings(
          id, file_url, status, duration_seconds, downloadable, created_at, processed_at, error
        )
      )
    `)
    .eq("student_id", studentId);
  if (error) return [];

  type Raw = {
    class: Record<string, unknown> | Record<string, unknown>[];
  };
  const out: Array<RecordingRow & { class_title: string; scheduled_at: string }> = [];
  for (const r of (data ?? []) as Raw[]) {
    const c = Array.isArray(r.class) ? r.class[0] : r.class;
    if (!c) continue;
    const recs = (c.recordings as Record<string, unknown>[] | undefined) ?? [];
    for (const rec of recs) {
      out.push({
        id:               rec.id as string,
        class_id:         c.id as string,
        file_url:         (rec.file_url as string | null) ?? null,
        file_size_bytes:  null,
        duration_seconds: (rec.duration_seconds as number | null) ?? null,
        status:           (rec.status as RecordingStatus) ?? "processing",
        error:            (rec.error as string | null) ?? null,
        downloadable:     Boolean(rec.downloadable),
        created_at:       rec.created_at as string,
        processed_at:     (rec.processed_at as string | null) ?? null,
        class_title:      c.title as string,
        scheduled_at:     c.scheduled_at as string,
      });
    }
  }
  // Sort newest first.
  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return out;
}

export function formatDurationHms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`
    : `${m}:${s.toString().padStart(2,"0")}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
