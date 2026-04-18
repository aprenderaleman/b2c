import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listChatsForUser } from "@/lib/chat";

/**
 * GET /api/chat
 * List the caller's conversations, sorted by last_message_at desc.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const chats = await listChatsForUser(userId);
  return NextResponse.json({ chats });
}
