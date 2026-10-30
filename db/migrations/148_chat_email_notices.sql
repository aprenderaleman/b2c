-- 148: Aviso por email de mensajes nuevos en el chat (Gelfis 2026-10-30).
-- Registro de cada email enviado por (chat, destinatario) para no mandar
-- más de uno cada 30 min aunque lleguen varios mensajes seguidos.
-- Lógica en web/lib/chat-email-notify.ts.

CREATE TABLE IF NOT EXISTS chat_email_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_email_notices_chat_user_idx
  ON chat_email_notices(chat_id, user_id, sent_at DESC);
