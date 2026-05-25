import { z } from "zod";
import { ATTACHMENT_LIMITS } from "./types";

const language = z.enum(["es", "de"]).optional();
const status   = z.enum(["active", "paused", "all"]).optional();
const level    = z.enum(["A1", "A2", "B1", "B2", "C1"]);

const leadStatusGroup = z.enum([
  "new", "in_conversation", "trial_scheduled", "trial_absent", "needs_human", "cold_lost",
]);

const leadLevel = z.enum(["A0", "A1-A2", "B1", "B2+", "unsure"]);

export const audienceFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_students"), status, language }),
  z.object({ kind: z.literal("all_teachers"), language }),
  z.object({ kind: z.literal("level"), level, status, language }),
  z.object({ kind: z.literal("group"), group_id: z.string().uuid(), language }),
  z.object({
    kind:          z.literal("leads"),
    status_groups: z.array(leadStatusGroup).optional(),
    levels:        z.array(leadLevel).optional(),
    language,
  }),
  z.object({
    kind:          z.literal("custom"),
    custom_emails: z.array(z.string().email()).optional(),
    custom_phones: z.array(z.string().min(5)).optional(),
  }),
]);

export const attachmentSchema = z.object({
  path:         z.string().min(1).max(500),
  name:         z.string().min(1).max(200),
  size:         z.number().int().nonnegative().max(ATTACHMENT_LIMITS.MAX_FILE_BYTES),
  content_type: z.string().min(1).max(120),
});

export const attachmentsArraySchema = z
  .array(attachmentSchema)
  .max(ATTACHMENT_LIMITS.MAX_FILES)
  .superRefine((arr, ctx) => {
    const total = arr.reduce((s, a) => s + a.size, 0);
    if (total > ATTACHMENT_LIMITS.MAX_TOTAL_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `total attachment size exceeds ${ATTACHMENT_LIMITS.MAX_TOTAL_BYTES} bytes`,
      });
    }
  });

export const previewBodySchema = z.object({
  audience_filter: audienceFilterSchema,
});

/**
 * Minimum slack between "now" and a scheduled_at value. Matches the
 * 5-minute dispatch cron interval — anything closer risks the cron
 * having already run for that window.
 */
export const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000;

/**
 * scheduled_at: ISO-8601 string. The endpoint resolves "future or not"
 * by comparing the parsed Date against now() server-side, so we don't
 * trust the client clock.
 */
const scheduledAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine(s => !isNaN(new Date(s).getTime()), { message: "invalid_date" })
  .optional();

export const sendBodySchema = z.object({
  audience_filter:  audienceFilterSchema,
  subject:          z.string().trim().min(1).max(200),
  message_markdown: z.string().trim().min(1).max(4000),
  channels:         z.array(z.enum(["email", "whatsapp"])).min(1),
  attachments:      attachmentsArraySchema.optional().default([]),
  scheduled_at:     scheduledAtSchema,
});

/**
 * /update accepts the same body as /send PLUS the row id. Used to edit
 * a still-queued broadcast (subject / body / channels / audience /
 * attachments / scheduled_at).
 */
export const updateBodySchema = sendBodySchema.extend({
  id: z.string().uuid(),
});

export const cancelBodySchema = z.object({
  id: z.string().uuid(),
});
