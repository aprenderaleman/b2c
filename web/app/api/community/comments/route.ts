import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getComments, addComment, deleteComment } from "@/lib/community";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const postId = url.searchParams.get("post_id");
  if (!postId) return NextResponse.json({ error: "post_id required" }, { status: 400 });

  const comments = await getComments(postId);
  return NextResponse.json({ comments });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { post_id, content } = await req.json();
  if (!post_id || !content?.trim()) {
    return NextResponse.json({ error: "post_id and content required" }, { status: 400 });
  }
  if (content.length > 1000) {
    return NextResponse.json({ error: "max 1000 chars" }, { status: 400 });
  }

  const id = await addComment(post_id, userId, content.trim());
  return NextResponse.json({ id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "superadmin" || role === "admin";

  const url = new URL(req.url);
  const commentId = url.searchParams.get("id");
  if (!commentId) return NextResponse.json({ error: "id required" }, { status: 400 });

  await deleteComment(commentId, userId, isAdmin);
  return NextResponse.json({ ok: true });
}
