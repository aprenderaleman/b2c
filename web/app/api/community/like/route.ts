import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toggleLike, notifyLike } from "@/lib/community";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { post_id } = await req.json();
  if (!post_id) return NextResponse.json({ error: "post_id required" }, { status: 400 });

  const result = await toggleLike(post_id, userId);

  if (result.liked) {
    notifyLike(post_id, userId).catch(() => null);
  }

  return NextResponse.json(result);
}
