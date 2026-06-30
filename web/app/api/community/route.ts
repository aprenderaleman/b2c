import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFeed, createPost, deletePost } from "@/lib/community";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const before = url.searchParams.get("before") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 50);

  const posts = await getFeed(userId, limit, before);
  return NextResponse.json({ posts });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json();
  const content = (body.content ?? "").trim();
  if (!content || content.length > 2000) {
    return NextResponse.json({ error: "content required (max 2000 chars)" }, { status: 400 });
  }

  const id = await createPost(userId, content, body.image_url, body.image_path);
  return NextResponse.json({ id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "superadmin" || role === "admin";

  const url = new URL(req.url);
  const postId = url.searchParams.get("id");
  if (!postId) return NextResponse.json({ error: "id required" }, { status: 400 });

  await deletePost(postId, userId, isAdmin);
  return NextResponse.json({ ok: true });
}
