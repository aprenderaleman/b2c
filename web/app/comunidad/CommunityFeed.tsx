"use client";

import { useState, useRef, useCallback } from "react";
import type { Post, Comment } from "@/lib/community";

type Props = {
  initialPosts: Post[];
  currentUserId: string;
  currentUserRole: string;
  currentUserName: string;
};

// ---------------------------------------------------------------------------
// Main Feed Component
// ---------------------------------------------------------------------------
export function CommunityFeed({ initialPosts, currentUserId, currentUserRole, currentUserName }: Props) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPosts.length >= 20);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const last = posts[posts.length - 1];
    const res = await fetch(`/api/community?before=${last.created_at}&limit=20`);
    const data = await res.json();
    if (data.posts.length < 20) setHasMore(false);
    setPosts(prev => [...prev, ...data.posts]);
    setLoading(false);
  };

  const handleNewPost = (post: Post) => {
    setPosts(prev => [post, ...prev]);
  };

  const handleDelete = async (postId: string) => {
    await fetch(`/api/community?id=${postId}`, { method: "DELETE" });
    setPosts(prev => prev.filter(p => p.id !== postId));
  };

  const handleLikeToggle = async (postId: string) => {
    const res = await fetch("/api/community/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId }),
    });
    const data = await res.json();
    setPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? { ...p, liked_by_me: data.liked, like_count: data.like_count }
          : p,
      ),
    );
  };

  const handleCommentAdded = (postId: string) => {
    setPosts(prev =>
      prev.map(p =>
        p.id === postId ? { ...p, comment_count: p.comment_count + 1 } : p,
      ),
    );
  };

  const isAdmin = currentUserRole === "superadmin" || currentUserRole === "admin";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Comunidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Comparte, pregunta y conecta con otros estudiantes y profesores
        </p>
      </div>

      <CreatePostBox
        currentUserName={currentUserName}
        currentUserRole={currentUserRole}
        onCreated={handleNewPost}
        currentUserId={currentUserId}
      />

      {posts.length === 0 && (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">
          <p className="text-lg font-medium">Aún no hay publicaciones</p>
          <p className="text-sm mt-1">Sé el primero en compartir algo con la comunidad</p>
        </div>
      )}

      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onDelete={handleDelete}
          onLikeToggle={handleLikeToggle}
          onCommentAdded={handleCommentAdded}
        />
      ))}

      {hasMore && (
        <div className="text-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 border border-brand-300 dark:border-brand-600 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors disabled:opacity-50"
          >
            {loading ? "Cargando…" : "Ver más publicaciones"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Post Box
// ---------------------------------------------------------------------------
function CreatePostBox({
  currentUserName,
  currentUserRole,
  currentUserId,
  onCreated,
}: {
  currentUserName: string;
  currentUserRole: string;
  currentUserId: string;
  onCreated: (post: Post) => void;
}) {
  const [content, setContent] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ url: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setImagePreview(URL.createObjectURL(file));
    setUploading(true);

    if (file.size > 10 * 1024 * 1024) {
      setImagePreview(null);
      setUploadError("La imagen es demasiado grande. Máximo 10 MB.");
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      return;
    }

    try {
      // 1. Get signed upload URL from our API
      const prepRes = await fetch("/api/community/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          size: file.size,
        }),
      });
      if (!prepRes.ok) {
        const data = await prepRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al preparar la subida");
      }
      const { upload_url, path } = await prepRes.json();

      // 2. Upload directly to Supabase Storage (bypasses Vercel body limit)
      const upRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upRes.ok) throw new Error("Error al subir la imagen al servidor");

      // 3. Get signed download URL
      const urlRes = await fetch(`/api/community/upload?path=${encodeURIComponent(path)}`, {
        method: "PUT",
      });
      if (!urlRes.ok) throw new Error("Error al generar URL de la imagen");
      const { url } = await urlRes.json();

      setImageData({ url, path });
    } catch (err) {
      setImagePreview(null);
      setUploadError(err instanceof Error ? err.message : "Error al subir la imagen");
      if (fileRef.current) fileRef.current.value = "";
    }
    setUploading(false);
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageData(null);
    setUploadError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);

    const res = await fetch("/api/community", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.trim(),
        image_url: imageData?.url ?? null,
        image_path: imageData?.path ?? null,
      }),
    });

    if (res.ok) {
      const { id } = await res.json();
      onCreated({
        id,
        author_id: currentUserId,
        content: content.trim(),
        image_url: imageData?.url ?? null,
        image_path: imageData?.path ?? null,
        pinned: false,
        like_count: 0,
        comment_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author_name: currentUserName,
        author_role: currentUserRole,
        author_avatar: null,
        liked_by_me: false,
      });
      setContent("");
      removeImage();
    }
    setSubmitting(false);
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Avatar name={currentUserName} role={currentUserRole} />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="¿Qué quieres compartir con la comunidad?"
          maxLength={2000}
          rows={3}
          className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />
      </div>

      {uploadError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {uploadError}
        </div>
      )}

      {imagePreview && (
        <div className="relative inline-block">
          <img
            src={imagePreview}
            alt="Preview"
            className="max-h-48 rounded-xl object-cover"
          />
          <button
            type="button"
            onClick={removeImage}
            className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/80"
          >
            ✕
          </button>
          {uploading && (
            <div className="absolute inset-0 rounded-xl bg-black/30 flex items-center justify-center">
              <span className="text-white text-sm font-medium">Subiendo…</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            Foto
          </button>
        </div>

        <div className="flex items-center gap-2">
          {content.length > 0 && (
            <span className={`text-xs ${content.length > 1900 ? "text-red-500" : "text-slate-400"}`}>
              {content.length}/2000
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || submitting || uploading}
            className="px-5 py-2 text-sm font-semibold rounded-xl bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Publicando…" : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post Card
// ---------------------------------------------------------------------------
function PostCard({
  post,
  currentUserId,
  isAdmin,
  onDelete,
  onLikeToggle,
  onCommentAdded,
}: {
  post: Post;
  currentUserId: string;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onLikeToggle: (id: string) => void;
  onCommentAdded: (postId: string) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = post.author_id === currentUserId || isAdmin;

  return (
    <article
      id={`post-${post.id}`}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Avatar name={post.author_name} role={post.author_role} url={post.author_avatar} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900 dark:text-slate-50 truncate">
              {post.author_name}
            </span>
            <RoleBadge role={post.author_role} />
          </div>
          <span className="text-xs text-slate-400">{formatAgo(post.created_at)}</span>
        </div>
        {post.pinned && (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-full">
            Fijado
          </span>
        )}
        {canDelete && (
          <div className="relative">
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDelete(post.id)}
                  className="text-xs text-red-600 dark:text-red-400 font-medium hover:underline"
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-slate-400 hover:underline"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1"
                title="Eliminar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
          {post.content}
        </p>
      </div>

      {/* Image */}
      {post.image_url && (
        <div className="px-4 pb-3">
          <img
            src={post.image_url}
            alt=""
            className="w-full max-h-96 object-cover rounded-xl"
            loading="lazy"
          />
        </div>
      )}

      {/* Stats bar */}
      {(post.like_count > 0 || post.comment_count > 0) && (
        <div className="px-4 pb-2 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          {post.like_count > 0 && <span>{post.like_count} {post.like_count === 1 ? "like" : "likes"}</span>}
          {post.comment_count > 0 && (
            <button type="button" onClick={() => setShowComments(true)} className="hover:underline">
              {post.comment_count} {post.comment_count === 1 ? "comentario" : "comentarios"}
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="border-t border-slate-100 dark:border-slate-800 flex">
        <button
          type="button"
          onClick={() => onLikeToggle(post.id)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors
            ${post.liked_by_me
              ? "text-red-500 dark:text-red-400"
              : "text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
            }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={post.liked_by_me ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
          </svg>
          Me gusta
        </button>
        <button
          type="button"
          onClick={() => setShowComments(!showComments)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />
          </svg>
          Comentar
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <CommentsSection
          postId={post.id}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onCommentAdded={() => onCommentAdded(post.id)}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Comments Section
// ---------------------------------------------------------------------------
function CommentsSection({
  postId,
  currentUserId,
  isAdmin,
  onCommentAdded,
}: {
  postId: string;
  currentUserId: string;
  isAdmin: boolean;
  onCommentAdded: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    const res = await fetch(`/api/community/comments?post_id=${postId}`);
    const data = await res.json();
    setComments(data.comments ?? []);
    setLoaded(true);
  }, [postId]);

  if (!loaded) {
    loadComments();
  }

  const handleSubmit = async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/community/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId, content: newComment.trim() }),
    });
    if (res.ok) {
      setNewComment("");
      onCommentAdded();
      await loadComments();
    }
    setSubmitting(false);
  };

  const handleDelete = async (commentId: string) => {
    await fetch(`/api/community/comments?id=${commentId}`, { method: "DELETE" });
    setComments(prev => prev.filter(c => c.id !== commentId));
  };

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 space-y-3">
      {!loaded && <p className="text-xs text-slate-400">Cargando comentarios…</p>}

      {comments.map(c => (
        <div key={c.id} className="flex items-start gap-2">
          <Avatar name={c.author_name} role={c.author_role} url={c.author_avatar} size="sm" />
          <div className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{c.author_name}</span>
              <RoleBadge role={c.author_role} size="xs" />
              <span className="text-[10px] text-slate-400">{formatAgo(c.created_at)}</span>
              {(c.author_id === currentUserId || isAdmin) && (
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  className="ml-auto text-[10px] text-slate-400 hover:text-red-500"
                >
                  Eliminar
                </button>
              )}
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words mt-0.5">{c.content}</p>
          </div>
        </div>
      ))}

      {/* New comment input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSubmit()}
          placeholder="Escribe un comentario…"
          maxLength={1000}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!newComment.trim() || submitting}
          className="px-3 py-2 text-sm font-medium rounded-xl bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
        >
          {submitting ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI Helpers
// ---------------------------------------------------------------------------
function Avatar({
  name,
  role,
  url,
  size = "md",
}: {
  name: string;
  role: string;
  url?: string | null;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-sm";
  const bg =
    role === "teacher"
      ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
      : role === "superadmin" || role === "admin"
        ? "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300"
        : "bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300";

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${dim} rounded-full object-cover`}
      />
    );
  }

  const initials = name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={`${dim} ${bg} rounded-full flex items-center justify-center font-bold shrink-0`}>
      {initials}
    </div>
  );
}

function RoleBadge({ role, size = "sm" }: { role: string; size?: "xs" | "sm" }) {
  const label =
    role === "teacher" ? "Profesor" :
    role === "superadmin" || role === "admin" ? "Admin" :
    "Estudiante";
  const colors =
    role === "teacher"
      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700"
      : role === "superadmin" || role === "admin"
        ? "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700"
        : "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700";
  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";

  return (
    <span className={`${textSize} ${colors} font-semibold px-1.5 py-0.5 rounded-full border`}>
      {label}
    </span>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}
