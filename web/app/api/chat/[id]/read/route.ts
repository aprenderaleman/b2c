import { NextResponse } from "next/server";
import { resolveChatCaller } from "@/lib/chat-auth";
import { isChatParticipant, markChatRead } from "@/lib/chat";

/**
 * POST /api/chat/[id]/read
 * Marks the caller's last_read_at = now(). Zeros the unread badge.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await resolveChatCaller();
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = caller.userId;

  const { id } = await params;
  if (!(await isChatParticipant(id, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await markChatRead(id, userId);
  return NextResponse.json({ ok: true });
}
