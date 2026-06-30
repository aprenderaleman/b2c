import { supabaseAdmin } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Post = {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  image_path: string | null;
  pinned: boolean;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_role: string;
  author_avatar: string | null;
  liked_by_me: boolean;
};

export type Comment = {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_role: string;
  author_avatar: string | null;
};

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
export async function getFeed(
  currentUserId: string,
  limit = 20,
  before?: string,
): Promise<Post[]> {
  const sb = supabaseAdmin();

  let query = sb
    .from("posts")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: posts, error } = await query;
  if (error) throw new Error(error.message);
  if (!posts || posts.length === 0) return [];

  const authorIds = [...new Set(posts.map((p: { author_id: string }) => p.author_id))];
  const { data: authors } = await sb
    .from("users")
    .select("id, full_name, role, avatar_url")
    .in("id", authorIds);
  const authorMap = new Map((authors ?? []).map((a: { id: string; full_name: string; role: string; avatar_url: string | null }) => [a.id, a]));

  const { data: myLikes } = await sb
    .from("post_likes")
    .select("post_id")
    .eq("user_id", currentUserId)
    .in("post_id", posts.map((p: { id: string }) => p.id));
  const likedSet = new Set((myLikes ?? []).map((l: { post_id: string }) => l.post_id));

  return posts.map((p: Record<string, unknown>) => {
    const author = authorMap.get(p.author_id as string) as { full_name: string; role: string; avatar_url: string | null } | undefined;
    return {
      id: p.id as string,
      author_id: p.author_id as string,
      content: p.content as string,
      image_url: p.image_url as string | null,
      image_path: p.image_path as string | null,
      pinned: p.pinned as boolean,
      like_count: p.like_count as number,
      comment_count: p.comment_count as number,
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
      author_name: author?.full_name ?? "Usuario",
      author_role: author?.role ?? "student",
      author_avatar: author?.avatar_url ?? null,
      liked_by_me: likedSet.has(p.id as string),
    };
  });
}

// ---------------------------------------------------------------------------
// Create post
// ---------------------------------------------------------------------------
export async function createPost(
  authorId: string,
  content: string,
  imageUrl?: string | null,
  imagePath?: string | null,
): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("posts")
    .insert({
      author_id: authorId,
      content,
      image_url: imageUrl ?? null,
      image_path: imagePath ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------------------------------------------------------------------------
// Delete post
// ---------------------------------------------------------------------------
export async function deletePost(postId: string, userId: string, isAdmin: boolean): Promise<void> {
  const sb = supabaseAdmin();
  let query = sb.from("posts").delete().eq("id", postId);
  if (!isAdmin) query = query.eq("author_id", userId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Like / Unlike
// ---------------------------------------------------------------------------
export async function toggleLike(
  postId: string,
  userId: string,
): Promise<{ liked: boolean; like_count: number }> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  } else {
    await sb.from("post_likes").insert({ post_id: postId, user_id: userId });
  }

  const { data: post } = await sb.from("posts").select("like_count").eq("id", postId).single();
  return {
    liked: !existing,
    like_count: post?.like_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export async function getComments(postId: string): Promise<Comment[]> {
  const sb = supabaseAdmin();
  const { data: comments, error } = await sb
    .from("post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!comments || comments.length === 0) return [];

  const authorIds = [...new Set(comments.map((c: { author_id: string }) => c.author_id))];
  const { data: authors } = await sb
    .from("users")
    .select("id, full_name, role, avatar_url")
    .in("id", authorIds);
  const authorMap = new Map((authors ?? []).map((a: { id: string; full_name: string; role: string; avatar_url: string | null }) => [a.id, a]));

  return comments.map((c: Record<string, unknown>) => {
    const author = authorMap.get(c.author_id as string) as { full_name: string; role: string; avatar_url: string | null } | undefined;
    return {
      id: c.id as string,
      post_id: c.post_id as string,
      author_id: c.author_id as string,
      content: c.content as string,
      created_at: c.created_at as string,
      author_name: author?.full_name ?? "Usuario",
      author_role: author?.role ?? "student",
      author_avatar: author?.avatar_url ?? null,
    };
  });
}

export async function addComment(
  postId: string,
  authorId: string,
  content: string,
): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("post_comments")
    .insert({ post_id: postId, author_id: authorId, content })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Notify post author (if different from commenter)
  const { data: post } = await sb.from("posts").select("author_id").eq("id", postId).single();
  if (post && post.author_id !== authorId) {
    const { data: commenter } = await sb.from("users").select("full_name").eq("id", authorId).single();
    await sb.from("notifications").insert({
      user_id: post.author_id,
      type: "post_commented",
      title: "Nuevo comentario",
      body: `${commenter?.full_name ?? "Alguien"} comentó en tu publicación`,
      link: `/comunidad#post-${postId}`,
    });
  }

  return data.id;
}

export async function deleteComment(
  commentId: string,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const sb = supabaseAdmin();
  let query = sb.from("post_comments").delete().eq("id", commentId);
  if (!isAdmin) query = query.eq("author_id", userId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Notify on like (called from toggle, only on new like)
// ---------------------------------------------------------------------------
export async function notifyLike(postId: string, likerId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { data: post } = await sb.from("posts").select("author_id").eq("id", postId).single();
  if (!post || post.author_id === likerId) return;

  const { data: liker } = await sb.from("users").select("full_name").eq("id", likerId).single();
  await sb.from("notifications").insert({
    user_id: post.author_id,
    type: "post_liked",
    title: "Nuevo like",
    body: `A ${liker?.full_name ?? "alguien"} le gustó tu publicación`,
    link: `/comunidad#post-${postId}`,
  });
}
