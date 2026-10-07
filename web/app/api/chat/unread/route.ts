import { NextResponse } from "next/server";
import { resolveChatCaller } from "@/lib/chat-auth";
import { listChatsForUser } from "@/lib/chat";

/**
 * GET /api/chat/unread → { unread: n }
 *
 * Total de mensajes sin leer del usuario en el chat de plataforma.
 * Alimenta el resaltado amarillo del ítem Mensajes/Chats en la
 * navegación (Gelfis 2026-10-10). Lo consulta el AppShell cada ~45s.
 */
export async function GET() {
  const caller = await resolveChatCaller();
  if (!caller) return NextResponse.json({ unread: 0 });
  const chats = await listChatsForUser(caller.userId);
  const unread = chats.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  return NextResponse.json({ unread });
}
