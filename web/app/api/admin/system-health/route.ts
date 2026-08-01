import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_HEARTBEAT_MIN = 30;

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!role || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ critical: "", stale: [] });
  }

  const sb = supabaseAdmin();

  const [{ data: cfgRow }, { data: beats }] = await Promise.all([
    sb.from("system_config").select("value").eq("key", "last_critical_issue").maybeSingle(),
    sb.from("system_heartbeat").select("service, last_tick"),
  ]);

  const critical = ((cfgRow?.value as string | undefined) ?? "").trim();

  const stale: string[] = [];
  const now = Date.now();
  for (const b of (beats ?? []) as { service: string; last_tick: string }[]) {
    if ((now - new Date(b.last_tick).getTime()) / 60_000 > STALE_HEARTBEAT_MIN) {
      stale.push(b.service);
    }
  }

  return NextResponse.json({ critical, stale }, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
