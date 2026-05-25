/**
 * Shared types for the /admin/comunicados (mass communication) flow.
 * Kept small and serialisable so the same shape travels through:
 *   UI form  →  /preview  →  /send  →  admin_broadcasts.audience_filter
 */

export type Language = "es" | "de";

export type Channel = "email" | "whatsapp";

/**
 * Who to send to. Every kind resolves to a concrete recipient list on
 * the server. `language` narrows by users.language_preference when set.
 *
 *   all_students   — every student (filtered by `status`)
 *   all_teachers   — every active teacher
 *   level          — students at A1|A2|B1|B2|C1 (filtered by `status`)
 *   group          — every member of student_groups.id
 *   leads          — rows from the `leads` table whose lifecycle status
 *                    matches one of the requested groups; ALWAYS excludes
 *                    leads who have been converted to users (avoid
 *                    double-targeting via the all_students audience) and
 *                    those who never accepted GDPR.
 *   custom         — free-form list of emails AND/OR E.164 phones; no DB
 *                    lookup other than a best-effort match so we can show
 *                    a name in the preview
 */
export type AudienceFilter =
  | {
      kind:     "all_students";
      status?:  "active" | "paused" | "all";   // default: active
      language?: Language;                     // optional ES/DE narrow
    }
  | {
      kind:     "all_teachers";
      language?: Language;
    }
  | {
      kind:     "level";
      level:    "A1" | "A2" | "B1" | "B2" | "C1";
      status?:  "active" | "paused" | "all";
      language?: Language;
    }
  | {
      kind:     "group";
      group_id: string;
      language?: Language;
    }
  | {
      kind:           "leads";
      status_groups?: LeadStatusGroup[];   // empty/undefined = all "active" groups
      levels?:        LeadLevel[];         // empty/undefined = any german_level
      language?:      Language;
    }
  | {
      kind:           "custom";
      custom_emails?: string[];   // bare emails
      custom_phones?: string[];   // E.164 after normalizePhone
    };

/**
 * Buckets we expose in the UI instead of the 19 raw lead_status values.
 * Each maps to a curated set of statuses below; both layers (UI + the
 * server resolver) use the same source of truth.
 */
export type LeadStatusGroup =
  | "new"
  | "in_conversation"
  | "trial_scheduled"
  | "trial_absent"
  | "needs_human"
  | "cold_lost";

/** UI-friendly mapping; resolver expands these into raw status arrays. */
export const LEAD_STATUS_GROUPS: Record<LeadStatusGroup, {
  label: string;
  emoji: string;
  raw:   string[];
}> = {
  new:              { label: "Nuevos",              emoji: "🆕", raw: ["new"] },
  in_conversation:  { label: "En conversación",     emoji: "💬", raw: ["contacted_1","contacted_2","contacted_3","contacted_4","contacted_5","in_conversation","link_sent"] },
  trial_scheduled:  { label: "Trial agendado",      emoji: "📅", raw: ["trial_scheduled","trial_reminded"] },
  trial_absent:     { label: "No asistió al trial", emoji: "❌", raw: ["trial_absent","absent_followup_1","absent_followup_2","absent_followup_3"] },
  needs_human:      { label: "Necesitan revisión",  emoji: "🙋", raw: ["needs_human"] },
  cold_lost:        { label: "Fríos / perdidos",    emoji: "🥶", raw: ["cold","lost"] },
};

/** Default selection in the UI (everything except cold/lost). */
export const LEAD_STATUS_GROUPS_DEFAULT: LeadStatusGroup[] = [
  "new", "in_conversation", "trial_scheduled", "trial_absent", "needs_human",
];

/**
 * Coarse level buckets actually used by the lead funnel — these are the
 * exact `german_level` enum values in Postgres. The funnel uses ranges
 * (not A1/A2/B1/B2/C1/C2 individually) because leads rarely know their
 * level precisely at intake.
 */
export type LeadLevel = "A0" | "A1-A2" | "B1" | "B2+" | "unsure";

export const LEAD_LEVELS: { value: LeadLevel; label: string; emoji: string }[] = [
  { value: "A0",     label: "A0 (principiante)",       emoji: "🌱" },
  { value: "A1-A2",  label: "A1–A2 (básico)",          emoji: "📗" },
  { value: "B1",     label: "B1 (intermedio)",         emoji: "📘" },
  { value: "B2+",    label: "B2+ (intermedio alto)",   emoji: "📕" },
  { value: "unsure", label: "No sabe / sin definir",   emoji: "❓" },
];

export type Recipient = {
  user_id:   string | null;    // null for custom entries that didn't match a user
  name:      string;           // best-effort display name ("" if unknown)
  email:     string | null;
  phone:     string | null;    // E.164
  language:  Language;         // defaults to "es" when unknown
  channels_available: Channel[];
};

export type PerChannelResult = {
  ok:    boolean;
  id:    string | null;
  error: string | null;
};

export type SendResultRow = {
  user_id:  string | null;
  name:     string;
  email:    string | null;
  phone:    string | null;
  email_r:    PerChannelResult | null;   // null = channel not attempted
  whatsapp_r: PerChannelResult | null;
};

/**
 * Reference to a file attached to a broadcast email. The file itself
 * lives in the `materials` Supabase bucket; this struct only carries
 * the metadata we need to (a) display in the UI, (b) decide whether
 * to allow the send (size/type rules), (c) re-download at send time.
 *
 * Attachments are EMAIL-ONLY — WhatsApp sends ignore them silently.
 */
export type Attachment = {
  path:         string;   // e.g. "comunicados/<adminId>/<uuid>-foo.pdf"
  name:         string;   // sanitised display name
  size:         number;   // bytes
  content_type: string;
};

/** Hard limits we enforce on the upload endpoint and the UI. */
export const ATTACHMENT_LIMITS = {
  MAX_FILES:        5,
  MAX_TOTAL_BYTES:  25 * 1024 * 1024,   // 25 MB total — Gmail's inbound ceiling
  MAX_FILE_BYTES:   25 * 1024 * 1024,   // 25 MB per file
  ALLOWED_MIME: [
    "application/pdf",
    "application/msword",                                                       // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  // .docx
  ] as const,
  ALLOWED_EXT: [".pdf", ".doc", ".docx"] as const,
};
