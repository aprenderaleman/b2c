import { supabaseAdmin } from "@/lib/supabase";
import { normalizePhone, isValidE164 } from "@/lib/phone";
import {
  LEAD_STATUS_GROUPS,
  LEAD_STATUS_GROUPS_DEFAULT,
  type AudienceFilter,
  type Language,
  type LeadStatusGroup,
  type Recipient,
} from "./types";

/**
 * Resolve an AudienceFilter into a concrete list of recipients.
 *
 * Invariants:
 *   • Deduped by user_id (when present) or email (for custom-only rows).
 *   • `channels_available` is inferred from the presence of email/phone,
 *     not from the caller's channel selection — the UI filters later.
 *   • Custom entries that happen to match a user (by email or normalized
 *     phone) are promoted to that user's row so we can show their name
 *     and whichever channel the other field provides.
 */
export async function resolveRecipients(
  filter: AudienceFilter,
): Promise<Recipient[]> {
  const sb = supabaseAdmin();

  if (filter.kind === "custom") {
    return resolveCustom(filter.custom_emails ?? [], filter.custom_phones ?? []);
  }

  if (filter.kind === "leads") {
    return resolveLeads(filter.status_groups, filter.language);
  }

  // Everything else pulls from users via a role/status scope.
  const language = "language" in filter ? filter.language : undefined;

  if (filter.kind === "all_teachers") {
    const { data } = await sb
      .from("teachers")
      .select("id, users!inner(id, full_name, email, phone, language_preference, active)")
      .eq("users.active", true);
    return fromUserJoinRows(data, language);
  }

  if (filter.kind === "group") {
    // Pull student_ids for the group, then each student's user row.
    const { data: members } = await sb
      .from("student_group_members")
      .select("student_id")
      .eq("group_id", filter.group_id);
    const studentIds = (members ?? []).map(m => m.student_id);
    if (studentIds.length === 0) return [];
    const { data } = await sb
      .from("students")
      .select("id, subscription_status, users!inner(id, full_name, email, phone, language_preference, active)")
      .in("id", studentIds)
      .eq("users.active", true);
    return fromUserJoinRows(data, language);
  }

  // all_students | level
  const status = filter.status ?? "active";
  let q = sb
    .from("students")
    .select("id, subscription_status, current_level, users!inner(id, full_name, email, phone, language_preference, active)")
    .eq("users.active", true);

  if (status !== "all") q = q.eq("subscription_status", status);
  if (filter.kind === "level") q = q.eq("current_level", filter.level);

  const { data } = await q;
  return fromUserJoinRows(data, language);
}

type JoinedRow = {
  users:
    | { id: string; full_name: string | null; email: string | null; phone: string | null; language_preference: Language | null; active: boolean }
    | Array<{ id: string; full_name: string | null; email: string | null; phone: string | null; language_preference: Language | null; active: boolean }>;
};

function fromUserJoinRows(
  rows: JoinedRow[] | null,
  language: Language | undefined,
): Recipient[] {
  const out = new Map<string, Recipient>();
  for (const r of rows ?? []) {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    if (!u || !u.active) continue;
    if (language && u.language_preference && u.language_preference !== language) continue;
    if (out.has(u.id)) continue;
    out.set(u.id, {
      user_id:  u.id,
      name:     u.full_name ?? "",
      email:    u.email ?? null,
      phone:    u.phone ?? null,
      language: (u.language_preference ?? "es") as Language,
      channels_available: channelsFor(u.email, u.phone),
    });
  }
  return [...out.values()];
}

function channelsFor(email: string | null | undefined, phone: string | null | undefined): Recipient["channels_available"] {
  const out: Recipient["channels_available"] = [];
  if (email) out.push("email");
  if (phone) out.push("whatsapp");
  return out;
}

/**
 * Custom recipient mode — a free-form mix of emails and phone numbers.
 * We try to match each entry back to a user row so the preview shows
 * a real name and can offer the other channel if available.
 */
async function resolveCustom(
  emails: string[],
  phones: string[],
): Promise<Recipient[]> {
  const sb = supabaseAdmin();

  const cleanEmails = uniq(emails.map(e => e.trim().toLowerCase()).filter(Boolean));
  const cleanPhones = uniq(
    phones
      .map(p => {
        try { return normalizePhone(p, "49"); }
        catch { return ""; }
      })
      .filter(p => p && isValidE164(p)),
  );

  const matches = new Map<string, {
    id: string; full_name: string | null; email: string | null; phone: string | null; language_preference: Language | null;
  }>();

  if (cleanEmails.length > 0) {
    const { data } = await sb
      .from("users")
      .select("id, full_name, email, phone, language_preference, active")
      .in("email", cleanEmails)
      .eq("active", true);
    for (const u of data ?? []) matches.set(u.id, u);
  }
  if (cleanPhones.length > 0) {
    const { data } = await sb
      .from("users")
      .select("id, full_name, email, phone, language_preference, active")
      .in("phone", cleanPhones)
      .eq("active", true);
    for (const u of data ?? []) matches.set(u.id, u);
  }

  const out = new Map<string, Recipient>();

  // Start from matched user rows — these carry a name + both channels.
  for (const u of matches.values()) {
    out.set(u.id, {
      user_id:  u.id,
      name:     u.full_name ?? "",
      email:    u.email ?? null,
      phone:    u.phone ?? null,
      language: (u.language_preference ?? "es") as Language,
      channels_available: channelsFor(u.email, u.phone),
    });
  }

  // Any email not matched → ghost recipient (email channel only).
  const matchedEmails = new Set(
    [...matches.values()].map(u => (u.email ?? "").toLowerCase()).filter(Boolean),
  );
  for (const e of cleanEmails) {
    if (matchedEmails.has(e)) continue;
    const key = `email:${e}`;
    if (out.has(key)) continue;
    out.set(key, {
      user_id:  null,
      name:     "",
      email:    e,
      phone:    null,
      language: "es",
      channels_available: ["email"],
    });
  }

  // Any phone not matched → ghost recipient (whatsapp channel only).
  const matchedPhones = new Set(
    [...matches.values()].map(u => u.phone ?? "").filter(Boolean),
  );
  for (const p of cleanPhones) {
    if (matchedPhones.has(p)) continue;
    const key = `phone:${p}`;
    if (out.has(key)) continue;
    out.set(key, {
      user_id:  null,
      name:     "",
      email:    null,
      phone:    p,
      language: "es",
      channels_available: ["whatsapp"],
    });
  }

  return [...out.values()];
}

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }

/**
 * Pull leads matching the requested status groups. Two safety filters
 * apply unconditionally:
 *
 *   • `gdpr_accepted = true`  — never message a lead who hasn't opted in.
 *   • `converted_to_user_id IS NULL` — converted leads already exist in
 *     the `users` table; messaging them via the leads audience would
 *     double-target them when combined with the all_students audience.
 *
 * The `status_groups` array maps to raw lead_status values via
 * LEAD_STATUS_GROUPS. Empty/undefined falls back to LEAD_STATUS_GROUPS_DEFAULT
 * (everything except cold/lost), matching the UI default.
 */
async function resolveLeads(
  groups:   LeadStatusGroup[] | undefined,
  language: Language | undefined,
): Promise<Recipient[]> {
  const sb = supabaseAdmin();

  const selectedGroups: LeadStatusGroup[] =
    (groups && groups.length > 0) ? groups : LEAD_STATUS_GROUPS_DEFAULT;
  const rawStatuses = selectedGroups
    .flatMap(g => LEAD_STATUS_GROUPS[g]?.raw ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);
  if (rawStatuses.length === 0) return [];

  let q = sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language, status, gdpr_accepted, converted_to_user_id")
    .eq("gdpr_accepted", true)
    .is("converted_to_user_id", null)
    .in("status", rawStatuses);

  if (language) q = q.eq("language", language);

  const { data } = await q;

  const out = new Map<string, Recipient>();
  for (const r of data ?? []) {
    const lead = r as {
      id: string;
      name: string | null;
      email: string | null;
      whatsapp_normalized: string | null;
      language: Language | null;
    };
    const email = lead.email?.trim() || null;
    const phone = lead.whatsapp_normalized?.trim() || null;
    if (!email && !phone) continue;       // nothing to send to

    out.set(lead.id, {
      user_id:  null,                     // leads are not users
      name:     lead.name ?? "",
      email,
      phone,
      language: (lead.language ?? "es") as Language,
      channels_available: channelsFor(email, phone),
    });
  }
  return [...out.values()];
}
