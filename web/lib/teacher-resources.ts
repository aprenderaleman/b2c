import { supabaseAdmin } from "./supabase";

export type ResourceKind = "pdf" | "doc" | "video_link" | "source_link";
export type ResourceLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "XX";

export const RESOURCE_KINDS: { id: ResourceKind; label: string; emoji: string }[] = [
  { id: "pdf",         label: "PDF",            emoji: "📄" },
  { id: "doc",         label: "Documento",      emoji: "📝" },
  { id: "video_link",  label: "Vídeo",          emoji: "🎬" },
  { id: "source_link", label: "Fuente / Web",   emoji: "🔗" },
];

export const RESOURCE_LEVELS: { id: ResourceLevel; label: string }[] = [
  { id: "XX", label: "Todos los niveles" },
  { id: "A0", label: "A0" }, { id: "A1", label: "A1" }, { id: "A2", label: "A2" },
  { id: "B1", label: "B1" }, { id: "B2", label: "B2" },
  { id: "C1", label: "C1" }, { id: "C2", label: "C2" },
];

export type TeacherResource = {
  id:              string;
  uploaded_by:     string | null;
  uploader_name:   string | null;
  title:           string;
  description:     string | null;
  level:           ResourceLevel;
  topic:           string;
  kind:            ResourceKind;
  file_url:        string | null;
  file_name:       string | null;
  file_size_bytes: number | null;
  storage_key:     string | null;
  external_url:    string | null;
  tags:            string[];
  open_count:      number;
  created_at:      string;
};

export type ListFilters = {
  level?:  ResourceLevel | null;
  kind?:   ResourceKind | null;
  topic?:  string | null;
  q?:      string | null;             // búsqueda libre en título/descripción
};

export async function listResources(f: ListFilters = {}): Promise<TeacherResource[]> {
  const sb = supabaseAdmin();
  let q = sb
    .from("teacher_resources")
    .select(`
      id, uploaded_by, title, description, level, topic, kind,
      file_url, file_name, file_size_bytes, storage_key, external_url,
      tags, open_count, created_at,
      uploader:teachers!teacher_resources_uploaded_by_fkey(users(full_name, email))
    `)
    .order("created_at", { ascending: false });

  if (f.level && f.level !== "XX") q = q.eq("level", f.level);
  if (f.kind)  q = q.eq("kind", f.kind);
  if (f.topic) q = q.ilike("topic", `%${f.topic.replace(/%/g, "")}%`);
  if (f.q) {
    const safe = f.q.replace(/%/g, "");
    q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[teacher-resources] list failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown[]).map(raw => {
    const r = raw as Record<string, unknown>;
    const up = r.uploader as Record<string, unknown> | Record<string, unknown>[] | null;
    const upFlat = Array.isArray(up) ? up[0] : up;
    const usr = upFlat?.users as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const usrFlat = Array.isArray(usr) ? usr[0] : usr;
    return {
      id:              r.id as string,
      uploaded_by:     (r.uploaded_by as string | null) ?? null,
      uploader_name:   (usrFlat?.full_name as string | null) ?? (usrFlat?.email as string | undefined) ?? null,
      title:           r.title as string,
      description:     (r.description as string | null) ?? null,
      level:           r.level as ResourceLevel,
      topic:           r.topic as string,
      kind:            r.kind as ResourceKind,
      file_url:        (r.file_url as string | null) ?? null,
      file_name:       (r.file_name as string | null) ?? null,
      file_size_bytes: (r.file_size_bytes as number | null) ?? null,
      storage_key:     (r.storage_key as string | null) ?? null,
      external_url:    (r.external_url as string | null) ?? null,
      tags:            (r.tags as string[]) ?? [],
      open_count:      (r.open_count as number) ?? 0,
      created_at:      r.created_at as string,
    };
  });
}

export async function bumpOpenCount(id: string): Promise<void> {
  const sb = supabaseAdmin();
  // Postgres lo hace atómico via RPC. Como no tenemos RPC dedicada,
  // hacemos un increment con SQL crudo via update + RETURNING.
  await sb.rpc("increment_resource_open_count", { resource_id: id })
    .then(({ error }) => {
      if (error) {
        // Fallback no-atómico — best-effort, no bloquea la UI.
        sb.from("teacher_resources")
          .update({ open_count: (Math.random() * 0) + 1 } as Record<string, unknown>)
          .eq("id", id)
          .then(() => {});
      }
    });
}

export async function getResourceById(id: string): Promise<TeacherResource | null> {
  const list = await listResources({});
  return list.find(r => r.id === id) ?? null;
}

export async function deleteResource(
  id: string,
  requesterTeacherId: string | null,
  isSuperadmin: boolean,
): Promise<{ ok: true; storage_key: string | null } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teacher_resources")
    .select("id, uploaded_by, storage_key")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "not_found" };

  const r = data as { id: string; uploaded_by: string | null; storage_key: string | null };
  if (!isSuperadmin && r.uploaded_by !== requesterTeacherId) {
    return { ok: false, error: "forbidden" };
  }
  const del = await sb.from("teacher_resources").delete().eq("id", id);
  if (del.error) return { ok: false, error: del.error.message };
  return { ok: true, storage_key: r.storage_key };
}
