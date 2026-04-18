import { supabaseAdmin } from "./supabase";

// =============================================================================
// Types
// =============================================================================

export type ChatType = "direct" | "group";

export type ChatListItem = {
  id:                 string;
  type:               ChatType;
  title:              string;                // computed for direct chats
  last_message_at:    string | null;
  last_message_preview: string | null;
  unread_count:       number;
  other_user_ids:     string[];
};

export type MessageRow = {
  id:                  string;
  chat_id:             string;
  author_id:           string;
  author_name:         string | null;
  author_email:        string;
  content:             string;
  attachments:         Array<{ url: string; name: string; size?: number; content_type?: string }>;
  reply_to_message_id: string | null;
  edited_at:           string | null;
  deleted:             boolean;
  sent_at:             string;
};

// =============================================================================
// Auto-creation: wire chats when classes are scheduled
// =============================================================================

/**
 * For an INDIVIDUAL class: make sure a direct chat between the teacher's
 * user and the student's user exists. Returns the chat id.
 */
export async function ensureDirectChat(
  teacherUserId: string,
  studentUserId: string,
): Promise<string> {
  const sb = supabaseAdmin();

  // Is there already a direct chat where BOTH users are members?
  const { data: existing } = await sb
    .from("chat_participants")
    .select("chat_id, chats!inner(type)")
    .in("user_id", [teacherUserId, studentUserId]);

  if (existing) {
    const counts: Record<string, number> = {};
    for (const r of existing as Array<{ chat_id: string; chats: { type: ChatType } | Array<{ type: ChatType }> }>) {
      const cc = Array.isArray(r.chats) ? r.chats[0] : r.chats;
      if (cc?.type === "direct") {
        counts[r.chat_id] = (counts[r.chat_id] ?? 0) + 1;
      }
    }
    for (const [chatId, n] of Object.entries(counts)) {
      if (n >= 2) return chatId;
    }
  }

  // Create new.
  const { data: chat, error: cErr } = await sb
    .from("chats")
    .insert({ type: "direct" })
    .select("id")
    .single();
  if (cErr || !chat) throw new Error(`chat create failed: ${cErr?.message ?? "unknown"}`);
  const chatId = chat.id as string;

  const { error: pErr } = await sb.from("chat_participants").insert([
    { chat_id: chatId, user_id: teacherUserId },
    { chat_id: chatId, user_id: studentUserId },
  ]);
  if (pErr) {
    await sb.from("chats").delete().eq("id", chatId);
    throw new Error(`chat_participants insert failed: ${pErr.message}`);
  }
  return chatId;
}

/**
 * For a GROUP class: reuse or create one chat per recurring series
 * (parent_class_id). Members = the teacher + every student across every
 * instance of the series. Adding more students to later instances extends
 * the membership.
 */
export async function ensureGroupChat(
  parentClassId: string,
  teacherUserId: string,
  studentUserIds: string[],
  title: string,
): Promise<string> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("chats")
    .select("id")
    .eq("class_group_id", parentClassId)
    .maybeSingle();

  let chatId: string;
  if (existing) {
    chatId = (existing as { id: string }).id;
  } else {
    const { data: chat, error: cErr } = await sb
      .from("chats")
      .insert({ type: "group", class_group_id: parentClassId, title })
      .select("id")
      .single();
    if (cErr || !chat) throw new Error(`group chat create failed: ${cErr?.message ?? "unknown"}`);
    chatId = chat.id as string;
  }

  // Upsert every participant (teacher + students). ON CONFLICT DO NOTHING
  // via the primary key (chat_id, user_id).
  const rows = [
    { chat_id: chatId, user_id: teacherUserId },
    ...studentUserIds.map(uid => ({ chat_id: chatId, user_id: uid })),
  ];
  await sb.from("chat_participants").upsert(rows, { onConflict: "chat_id,user_id", ignoreDuplicates: true });

  return chatId;
}

/**
 * Wire chats for a freshly-created class (single or series). Called from
 * the class-create endpoint after class rows + participants exist.
 */
export async function wireChatsForClass(args: {
  classId:        string;              // the parent class id
  type:           "individual" | "group";
  teacherId:      string;
  studentIds:     string[];
  classTitle:     string;
}): Promise<void> {
  const sb = supabaseAdmin();

  // Resolve teacher user_id.
  const { data: t } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", args.teacherId)
    .maybeSingle();
  const teacherUserId = (t as { user_id: string } | null)?.user_id;
  if (!teacherUserId) return;

  // Resolve every student user_id.
  const { data: students } = await sb
    .from("students")
    .select("user_id")
    .in("id", args.studentIds);
  const studentUserIds = (students ?? []).map(s => (s as { user_id: string }).user_id).filter(Boolean);
  if (studentUserIds.length === 0) return;

  if (args.type === "individual") {
    await ensureDirectChat(teacherUserId, studentUserIds[0]);
  } else {
    await ensureGroupChat(args.classId, teacherUserId, studentUserIds, args.classTitle);
  }
}

// =============================================================================
// Queries for the UI
// =============================================================================

export async function listChatsForUser(userId: string): Promise<ChatListItem[]> {
  const sb = supabaseAdmin();

  const { data: participations } = await sb
    .from("chat_participants")
    .select(`
      chat_id, last_read_at,
      chat:chats!inner(id, type, title, class_group_id, last_message_at, created_at)
    `)
    .eq("user_id", userId);
  if (!participations) return [];

  type Row = {
    chat_id:       string;
    last_read_at:  string | null;
    chat: {
      id: string; type: ChatType; title: string | null;
      class_group_id: string | null; last_message_at: string | null;
      created_at: string;
    } | Array<{
      id: string; type: ChatType; title: string | null;
      class_group_id: string | null; last_message_at: string | null;
      created_at: string;
    }>;
  };
  const rows = participations as unknown as Row[];

  const chatIds = rows.map(r => r.chat_id);
  if (chatIds.length === 0) return [];

  // Fetch other participants (for direct chats to compute title) + unread counts + preview.
  const { data: allParts } = await sb
    .from("chat_participants")
    .select("chat_id, user_id, users!inner(full_name, email)")
    .in("chat_id", chatIds);

  const byChat: Record<string, Array<{ user_id: string; full_name: string | null; email: string }>> = {};
  for (const p of (allParts ?? []) as Array<{ chat_id: string; user_id: string; users: unknown }>) {
    const u = Array.isArray(p.users) ? p.users[0] : p.users;
    const entry = { user_id: p.user_id, full_name: (u as { full_name: string | null })?.full_name ?? null, email: (u as { email: string })?.email ?? "" };
    byChat[p.chat_id] ??= [];
    byChat[p.chat_id].push(entry);
  }

  // Last message preview + unread count per chat.
  const { data: lastMessages } = await sb
    .from("messages")
    .select("chat_id, content, sent_at, author_id, deleted")
    .in("chat_id", chatIds)
    .order("sent_at", { ascending: false });

  const lastByChat: Record<string, { content: string; sent_at: string }> = {};
  for (const m of (lastMessages ?? []) as Array<{ chat_id: string; content: string; sent_at: string; deleted: boolean }>) {
    if (m.deleted) continue;
    if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = { content: m.content, sent_at: m.sent_at };
  }

  const unreadByChat: Record<string, number> = {};
  for (const r of rows) {
    const afterTs = r.last_read_at ?? "1970-01-01T00:00:00Z";
    const count = (lastMessages ?? []).filter(m => {
      const mm = m as { chat_id: string; sent_at: string; author_id: string; deleted: boolean };
      return mm.chat_id === r.chat_id
          && !mm.deleted
          && mm.author_id !== userId
          && mm.sent_at > afterTs;
    }).length;
    unreadByChat[r.chat_id] = count;
  }

  return rows.map(r => {
    const chat = Array.isArray(r.chat) ? r.chat[0] : r.chat;
    const parts = byChat[r.chat_id] ?? [];
    const others = parts.filter(p => p.user_id !== userId);
    const title = chat.type === "direct"
      ? (others[0]?.full_name ?? others[0]?.email ?? "Conversación")
      : (chat.title ?? "Grupo");
    const lm = lastByChat[r.chat_id];
    return {
      id:                   chat.id,
      type:                 chat.type,
      title,
      last_message_at:      lm?.sent_at ?? chat.last_message_at,
      last_message_preview: lm?.content ?? null,
      unread_count:         unreadByChat[r.chat_id] ?? 0,
      other_user_ids:       others.map(o => o.user_id),
    };
  }).sort((a, b) => {
    const ax = a.last_message_at ?? "";
    const bx = b.last_message_at ?? "";
    return bx.localeCompare(ax);
  });
}

export async function isChatParticipant(chatId: string, userId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("chat_participants").select("chat_id").eq("chat_id", chatId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function listChatMessages(chatId: string, limit = 100): Promise<MessageRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("messages")
    .select(`
      id, chat_id, author_id, content, attachments,
      reply_to_message_id, edited_at, deleted, sent_at,
      author:users!inner(full_name, email)
    `)
    .eq("chat_id", chatId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) return [];

  type Raw = {
    id: string; chat_id: string; author_id: string; content: string;
    attachments: unknown; reply_to_message_id: string | null;
    edited_at: string | null; deleted: boolean; sent_at: string;
    author: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
  };

  const out: MessageRow[] = (data as Raw[]).map(m => {
    const a = Array.isArray(m.author) ? m.author[0] : m.author;
    return {
      id:                   m.id,
      chat_id:              m.chat_id,
      author_id:            m.author_id,
      author_name:          a?.full_name ?? null,
      author_email:         a?.email ?? "",
      content:              m.content,
      attachments:          Array.isArray(m.attachments) ? (m.attachments as MessageRow["attachments"]) : [],
      reply_to_message_id:  m.reply_to_message_id,
      edited_at:            m.edited_at,
      deleted:              m.deleted,
      sent_at:              m.sent_at,
    };
  });
  // Return oldest first for chronological rendering.
  return out.reverse();
}

export async function sendMessage(args: {
  chatId:    string;
  authorId:  string;
  content:   string;
  attachments?: MessageRow["attachments"];
  replyTo?:  string | null;
}): Promise<MessageRow | null> {
  if (!args.content.trim() && (!args.attachments || args.attachments.length === 0)) {
    return null;
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("messages")
    .insert({
      chat_id:              args.chatId,
      author_id:            args.authorId,
      content:              args.content,
      attachments:          args.attachments ?? [],
      reply_to_message_id:  args.replyTo ?? null,
    })
    .select("id, chat_id, author_id, content, attachments, reply_to_message_id, edited_at, deleted, sent_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert_failed");

  // Also bump last_read_at for the author so their unread count stays 0.
  await sb
    .from("chat_participants")
    .update({ last_read_at: (data as { sent_at: string }).sent_at })
    .eq("chat_id", args.chatId)
    .eq("user_id", args.authorId);

  return {
    ...(data as Omit<MessageRow, "author_name" | "author_email" | "attachments"> & {
      attachments: unknown;
    }),
    author_name:  null,
    author_email: "",
    attachments:  Array.isArray(data.attachments) ? (data.attachments as MessageRow["attachments"]) : [],
  };
}

export async function markChatRead(chatId: string, userId: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("chat_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", userId);
}
