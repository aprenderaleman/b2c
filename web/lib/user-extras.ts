import { supabaseAdmin } from "./supabase";

/**
 * Fetch the iCal token we mint per-user in migration 028. Used to build
 * the personal calendar subscription URL rendered by CalendarSyncButton.
 */
export async function getUserIcalToken(userId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("ical_token")
    .eq("id", userId)
    .maybeSingle();
  return (data as { ical_token: string } | null)?.ical_token ?? null;
}

/**
 * Absolute base URL for the app — used when building links that end up in
 * iCal feeds / PDFs / emails. Falls back to the configured public URL.
 */
export function publicBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL
      ?? process.env.PUBLIC_SITE_URL
      ?? "https://b2c.aprender-aleman.de";
}

export function icalUrlFor(token: string): string {
  return `${publicBaseUrl()}/api/ical/${token}.ics`;
}
