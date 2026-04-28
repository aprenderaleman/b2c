import { redirect } from "next/navigation";

/**
 * Legacy /funnel URL — redirected to the new /agendar flow.
 *
 * Some external assets (older WhatsApp messages, Google Ads, embeds)
 * may still link here. Permanent redirect keeps SEO clean and lands
 * the visitor on the current funnel without seeing a dead page.
 */
export default function FunnelLegacyRedirect() {
  redirect("/agendar/cuando");
}
