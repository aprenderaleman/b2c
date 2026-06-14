/**
 * Google Ads API client for fetching daily campaign metrics.
 *
 * Uses the Google Ads REST API directly (no heavyweight SDK).
 * Requires OAuth2 credentials + developer token.
 */

const GOOGLE_ADS_API_VERSION = "v18";
const BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

export type DailyAdMetrics = {
  date: string;
  campaign_id: string;
  campaign_name: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
};

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Ads OAuth credentials not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed: ${res.status} ${text}`);
  }

  const json = await res.json() as { access_token: string };
  return json.access_token;
}

export async function fetchDailyReport(date: string): Promise<DailyAdMetrics[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!customerId || !devToken) {
    throw new Error("Google Ads customer ID or developer token not configured");
  }

  const cleanId = customerId.replace(/-/g, "");
  const accessToken = await getAccessToken();

  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE segments.date = '${date}'
      AND campaign.status != 'REMOVED'
  `;

  const res = await fetch(
    `${BASE_URL}/customers/${cleanId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads API error: ${res.status} ${text}`);
  }

  const json = await res.json() as Array<{
    results?: Array<{
      campaign: { id: string; name: string };
      metrics: {
        impressions: string;
        clicks: string;
        costMicros: string;
        conversions: number;
      };
      segments: { date: string };
    }>;
  }>;

  const results: DailyAdMetrics[] = [];
  for (const batch of json) {
    for (const row of batch.results ?? []) {
      results.push({
        date: row.segments.date,
        campaign_id: row.campaign.id,
        campaign_name: row.campaign.name,
        impressions: parseInt(row.metrics.impressions, 10) || 0,
        clicks: parseInt(row.metrics.clicks, 10) || 0,
        cost_micros: parseInt(row.metrics.costMicros, 10) || 0,
        conversions: row.metrics.conversions ?? 0,
      });
    }
  }

  return results;
}
