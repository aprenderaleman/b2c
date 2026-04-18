import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isChatParticipant, listChatMessages, sendMessage } from "@/lib/chat";

/**
 * GET /api/chat/[id]/messages    → last 100 messages (oldest first)
 * POST /api/chat/[id]/messages   → { content, attachments?, replyTo? }
 */

const SendBody = z.object({
  content:     z.string().max(8000).default(""),
  attachments: z.array(z.object({
    url:          z.string().url(),
    name:         z.string().max(200),
    size:         z.number().int().nonnegative().optional(),
    content_type: z.string().max(100).optional(),
  })).max(10).optional(),
  replyTo:     z.string().uuid().nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { id } = await params;
  if (!(await isChatParticipant(id, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const messages = await listChatMessages(id);
  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { id } = await params;
  if (!(await isChatParticipant(id, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = SendBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const message = await sendMessage({
      chatId:      id,
      authorId:    userId,
      content:     parsed.data.content,
      attachments: parsed.data.attachments,
      replyTo:     parsed.data.replyTo ?? null,
    });
    if (!message) {
      return NextResponse.json({ error: "empty_message" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return NextResponse.json(
      { error: "send_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
