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
