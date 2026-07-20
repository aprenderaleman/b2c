import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

// Envs leídas en cada request (no top-level) para que un cambio en
// .env.local se recoja sin reiniciar el dev server — importante para
// diagnóstico de META_TEST_EVENT_CODE.
function getEnv() {
  return {
    PIXEL_ID:        process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "",
    ACCESS_TOKEN:    process.env.META_CAPI_TOKEN ?? "",
    TEST_EVENT_CODE: process.env.META_TEST_EVENT_CODE || undefined,
  };
}

function sha256(val: string): string {
  return createHash("sha256").update(val.trim().toLowerCase()).digest("hex");
}

// Ofusca el token en logs: primeros 6 + últimos 4.
function tokenTag(t: string): string {
  if (t.length < 12) return "***";
  return `${t.slice(0, 6)}…${t.slice(-4)} (len=${t.length})`;
}

export async function POST(req: Request) {
  const { PIXEL_ID, ACCESS_TOKEN, TEST_EVENT_CODE } = getEnv();

  console.log("[meta-capi] request received", {
    pixel_id:         PIXEL_ID || "(missing)",
    token:            ACCESS_TOKEN ? tokenTag(ACCESS_TOKEN) : "(missing)",
    test_event_code:  TEST_EVENT_CODE ?? "(not set — events go to REAL bucket)",
    node_env:         process.env.NODE_ENV,
  });

  if (!ACCESS_TOKEN || !PIXEL_ID) {
    console.error("[meta-capi] not_configured — envs missing");
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

  // Log del payload que se envía a Meta — todo lo sensible ya está
  // hasheado (em/ph). Útil para verificar test_event_code en el root.
  console.log("[meta-capi] payload →", JSON.stringify(payload, null, 2));

  const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (fetchErr) {
    // Errores de red (DNS, timeout, TLS) — NO se capturaban antes.
    console.error("[meta-capi] fetch to graph.facebook.com FAILED:", fetchErr);
    return NextResponse.json({
      ok: false,
      reason: "network_error",
      detail: String(fetchErr),
    }, { status: 502 });
  }

  const rawText = await res.text();
  let result: unknown = {};
  try { result = JSON.parse(rawText); } catch { /* deja el raw */ }

  console.log("[meta-capi] response ←", {
    status:      res.status,
    ok:          res.ok,
    body:        result,
    raw_if_json_fail: typeof result === "object" && Object.keys(result as object).length === 0 ? rawText : undefined,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, meta_status: res.status, meta: result }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    events_received: (result as { events_received?: number }).events_received,
    fbtrace_id:      (result as { fbtrace_id?: string }).fbtrace_id,
    test_mode:       !!TEST_EVENT_CODE,
  });
}
