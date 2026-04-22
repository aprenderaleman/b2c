import { supabaseAdmin } from "./supabase";

/**
 * Free-form timestamped notes that admins keep on student/teacher
 * profiles. Lives in `admin_notes` (migration 031). All access is
 * service-role via supabaseAdmin — guards live in the API routes
 * that call these helpers.
 */

export type NoteTargetType = "student" | "teacher";

export type AdminNoteRow = {
  id:          string;
  target_type: NoteTargetType;
  target_id:   string;
  author_id:   string | null;
  author_name: string | null;    // joined from users
  author_email: string;           // joined from users
  content:     string;
  created_at:  string;
  updated_at:  string;
};

export async function listAdminNotes(
  targetType: NoteTargetType,
  targetId:   string,
): Promise<AdminNoteRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_notes")
    .select("id, target_type, target_id, author_id, content, created_at, updated_at, users:author_id(full_name, email)")
    .eq("target_type", targetType)
    .eq("target_id",   targetId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Row = {
    id: string; target_type: NoteTargetType; target_id: string;
    author_id: string | null; content: string;
    created_at: string; updated_at: string;
    users: { full_name: string | null; email: string } |
           Array<{ full_name: string | null; email: string }> | null;
  };
  return (data as Row[]).map(r => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      id:           r.id,
      target_type:  r.target_type,
      target_id:    r.target_id,
      author_id:    r.author_id,
      author_name:  u?.full_name ?? null,
      author_email: u?.email ?? "",
      content:      r.content,
      created_at:   r.created_at,
      updated_at:   r.updated_at,
    };
  });
}

export async function createAdminNote(
  targetType: NoteTargetType,
  targetId:   string,
  authorId:   string,
  content:    string,
): Promise<AdminNoteRow> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("admin_notes")
    .insert({
      target_type: targetType,
      target_id:   targetId,
      author_id:   authorId,
      content:     content.trim(),
    })
    .select("id")
    .single();
  if (error) throw error;

  // Reload with joined user info for the UI.
  const created = (await listAdminNotes(targetType, targetId))
    .find(n => n.id === (data as { id: string }).id);
  if (!created) throw new Error("note created but not readable");
  return created;
}

export async function deleteAdminNote(
  noteId:       string,
  currentUserId: string,
  currentRole:   "admin" | "superadmin",
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();
  // Fetch to check authorship
  const { data: row, error: qErr } = await sb
    .from("admin_notes")
    .select("author_id")
    .eq("id", noteId)
    .maybeSingle();
  if (qErr) return { ok: false, error: qErr.message };
  if (!row) return { ok: false, error: "not_found" };

  const authorId = (row as { author_id: string | null }).author_id;
  const isAuthor = authorId === currentUserId;
  const isSuper  = currentRole === "superadmin";
  if (!isAuthor && !isSuper) return { ok: false, error: "forbidden" };

  const { error: dErr } = await sb.from("admin_notes").delete().eq("id", noteId);
  if (dErr) return { ok: false, error: dErr.message };
  return { ok: true };
}
