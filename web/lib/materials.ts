import { supabaseAdmin } from "./supabase";

export type MaterialVisibility = "private" | "shared";

export type MaterialRow = {
  id:              string;
  teacher_id:      string;
  title:           string;
  description:     string | null;
  storage_path:    string;
  file_url:        string;
  file_name:       string;
  file_type:       string;
  file_size_bytes: number | null;
  tags:            string[];
  visibility:      MaterialVisibility;
  created_at:      string;
};

/**
 * Materials the student can see: items uploaded by any teacher who
 * currently teaches them (has at least one class with this student
 * as a participant, regardless of class status) AND marked `shared`.
 * Private items stay private.
 */
export async function listMaterialsVisibleToStudent(studentId: string): Promise<Array<MaterialRow & {
  teacher_name: string | null;
}>> {
  const sb = supabaseAdmin();

  // 1. Teachers of the student's classes
  const { data: teacherRows } = await sb
    .from("classes")
    .select("teacher_id, class_participants!inner(student_id)")
    .eq("class_participants.student_id", studentId)
    .not("teacher_id", "is", null);

  const teacherIds = Array.from(new Set(
    ((teacherRows ?? []) as Array<{ teacher_id: string | null }>)
      .map(r => r.teacher_id)
      .filter((x): x is string => !!x),
  ));
  if (teacherIds.length === 0) return [];

  // 2. Their shared materials
  const { data, error } = await sb
    .from("materials")
    .select(`
      id, teacher_id, title, description, storage_path, file_url, file_name,
      file_type, file_size_bytes, tags, visibility, created_at,
      teacher:teachers!inner(users!inner(full_name, email))
    `)
    .in("teacher_id", teacherIds)
    .eq("visibility", "shared")
    .order("created_at", { ascending: false });
  if (error) return [];

  return ((data ?? []) as unknown[]).map(raw => {
    const r = raw as Record<string, unknown>;
    const t = r.teacher as Record<string, unknown> | Record<string, unknown>[];
    const tf = Array.isArray(t) ? t[0] : t;
    const u = tf?.users as Record<string, unknown> | Record<string, unknown>[];
    const uf = Array.isArray(u) ? u[0] : u;
    return {
      id:              r.id as string,
      teacher_id:      r.teacher_id as string,
      title:           r.title as string,
      description:     (r.description as string | null) ?? null,
      storage_path:    r.storage_path as string,
      file_url:        r.file_url as string,
      file_name:       r.file_name as string,
      file_type:       r.file_type as string,
      file_size_bytes: (r.file_size_bytes as number | null) ?? null,
      tags:            (r.tags as string[]) ?? [],
      visibility:      r.visibility as MaterialVisibility,
      created_at:      r.created_at as string,
      teacher_name:    (uf?.full_name as string | null) ?? (uf?.email as string | undefined) ?? null,
    };
  });
}

export async function listTeacherMaterials(teacherId: string, q?: string, tag?: string): Promise<MaterialRow[]> {
  const sb = supabaseAdmin();
  let query = sb
    .from("materials")
    .select("id, teacher_id, title, description, storage_path, file_url, file_name, file_type, file_size_bytes, tags, visibility, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (q) {
    const safe = q.replace(/[%]/g, "");
    query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  if (tag) query = query.contains("tags", [tag]);

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as MaterialRow[];
}

export async function createMaterial(args: {
  teacherId:    string;
  title:        string;
  description:  string | null;
  storagePath:  string;
  fileUrl:      string;
  fileName:     string;
  fileType:     string;
  fileSize:     number;
  tags:         string[];
  visibility:   MaterialVisibility;
}): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("materials").insert({
    teacher_id:      args.teacherId,
    title:           args.title,
    description:     args.description,
    storage_path:    args.storagePath,
    file_url:        args.fileUrl,
    file_name:       args.fileName,
    file_type:       args.fileType,
    file_size_bytes: args.fileSize,
    tags:            args.tags,
    visibility:      args.visibility,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return data.id as string;
}

export async function deleteMaterial(teacherId: string, materialId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  // Fetch storage_path for cleanup.
  const { data } = await sb
    .from("materials")
    .select("storage_path")
    .eq("id", materialId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!data) return false;
  await sb.storage.from("materials").remove([(data as { storage_path: string }).storage_path]);
  const { error } = await sb.from("materials").delete().eq("id", materialId).eq("teacher_id", teacherId);
  return !error;
}
