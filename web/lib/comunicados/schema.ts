import { z } from "zod";

const language = z.enum(["es", "de"]).optional();
const status   = z.enum(["active", "paused", "all"]).optional();
const level    = z.enum(["A1", "A2", "B1", "B2", "C1"]);

export const audienceFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_students"), status, language }),
  z.object({ kind: z.literal("all_teachers"), language }),
  z.object({ kind: z.literal("level"), level, status, language }),
  z.object({ kind: z.literal("group"), group_id: z.string().uuid(), language }),
  z.object({
    kind:          z.literal("custom"),
    custom_emails: z.array(z.string().email()).optional(),
    custom_phones: z.array(z.string().min(5)).optional(),
  }),
]);

export const previewBodySchema = z.object({
  audience_filter: audienceFilterSchema,
});

export const sendBodySchema = z.object({
  audience_filter:  audienceFilterSchema,
  subject:          z.string().trim().min(1).max(200),
  message_markdown: z.string().trim().min(1).max(4000),
  channels:         z.array(z.enum(["email", "whatsapp"])).min(1),
});
