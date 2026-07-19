import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN ?? "";
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || undefined;

function sha256(val: string): string {
  return createHash("sha256").update(val.trim().toLowerCase()).digest("hex");
}

export async function POST(req: Request) {
  if (!ACCESS_TOKEN || !PIXEL_ID) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  let body: {
    eventId: string;
    email?: string;
    phone?: string;
    sourceUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.eventId) {
    return NextResponse.json({ error: "missing_eventId" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          ?? req.headers.get("x-real-ip")
          ?? "";
  const ua = req.headers.get("user-agent") ?? "";

  const userData: Record<string, string> = {
    client_user_agent: ua,
    client_ip_address: ip,
  };
  if (body.email) userData.em = sha256(body.email);
  if (body.phone) {
    const digits = body.phone.replace(/\D/g, "");
    if (digits.length >= 8) userData.ph = sha256(digits);
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Schedule",
        event_time: Math.floor(Date.now() / 1000),
        event_id: body.eventId,
        event_source_url: body.sourceUrl ?? `${process.env.NEXT_PUBLIC_SITE_URL}/confirmacion`,
        action_source: "website",
        user_data: userData,
      },
    ],
  };

  if (TEST_EVENT_CODE) {
    payload.test_event_code = TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[meta-capi] error:", res.status, result);
    return NextResponse.json({ ok: false, meta: result }, { status: 502 });
  }

  return NextResponse.json({ ok: true, events_received: (result as { events_received?: number }).events_received });
}
