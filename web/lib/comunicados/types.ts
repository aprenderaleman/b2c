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
      kind:           "custom";
      custom_emails?: string[];   // bare emails
      custom_phones?: string[];   // E.164 after normalizePhone
    };

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
