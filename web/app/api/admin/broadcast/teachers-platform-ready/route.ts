import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTeacherPlatformAnnouncement } from "@/lib/email/send";

/**
 * POST /api/admin/broadcast/teachers-platform-ready
 *
 * One-off broadcast: emails every active teacher the "new platform is
 * live" announcement ahead of the Zoom→B2C cutover on 2026-04-27.
 *
 * Body (optional):
 *   { test_to: string } — send ONLY to this address (no DB read). Used
 *   to verify the Resend pipeline before firing the real broadcast, or
 *   to self-preview the email. Reuses Sabine's name as the sample.
 *
 * Admin-only. Returns a per-recipient result list so the admin page
 * can show ok/error next to each name.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = "https://b2c.aprender-aleman.de/login";
const VIDEO_URL    = "https://www.youtube.com/watch?v=6-Nek-2EPp8";
const CUTOVER_DATE = "lunes 27 de abril";

const Body = z.object({
  test_to:    z.string().email().optional(),
  test_name:  z.string().trim().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Body is optional — empty body means "real broadcast to all teachers".
  let body: z.infer<typeof Body> = {};
  try {
    const raw = await req.json();
    const parsed = Body.safeParse(raw);
    if (parsed.success) body = parsed.data;
  } catch {
    // no body — treat as real broadcast
  }

  // Test mode: send ONE email to the given address, mimic the real
  // template but with a sample name so we can spot-check rendering.
  if (body.test_to) {
    const res = await sendTeacherPlatformAnnouncement(body.test_to, {
      name:        body.test_name ?? "Sabine",
      email:       body.test_to,
      platformUrl: PLATFORM_URL,
      videoUrl:    VIDEO_URL,
      cutoverDate: CUTOVER_DATE,
    });
    return NextResponse.json({
      ok:      res.ok,
      sent:    res.ok ? 1 : 0,
      failed:  res.ok ? 0 : 1,
      test:    true,
      results: [{
        name:       body.test_name ?? "Sabine",
        email:      body.test_to,
        ok:         res.ok,
        error:      res.ok ? undefined : res.error,
        message_id: res.ok ? res.id : undefined,
      }],
    });
  }

  const sb = supabaseAdmin();
  const { data: teachers, error } = await sb
    .from("teachers")
    .select("id, users!inner(full_name, email, active)")
    .eq("users.active", true);
  if (error) {
    return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    users: { full_name: string | null; email: string; active: boolean } |
           Array<{ full_name: string | null; email: string; active: boolean }>;
  };
  const list = ((teachers ?? []) as Row[]).map(r => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      teacher_id: r.id,
      name:       u?.full_name ?? "",
      email:      u?.email ?? "",
    };
  }).filter(x => x.email);

  // Sequential send — avoids hammering Resend (3 recipients, no need to parallelise).
  const results: Array<{
    teacher_id: string; name: string; email: string;
    ok: boolean; error?: string; message_id?: string | null;
  }> = [];
  for (const t of list) {
    const res = await sendTeacherPlatformAnnouncement(t.email, {
      name:        t.name || t.email,
      email:       t.email,
      platformUrl: PLATFORM_URL,
      videoUrl:    VIDEO_URL,
      cutoverDate: CUTOVER_DATE,
    });
    results.push({
      teacher_id: t.teacher_id,
      name:       t.name,
      email:      t.email,
      ok:         res.ok,
      error:      res.ok ? undefined : res.error,
      message_id: res.ok ? res.id : undefined,
    });
  }

  const okCount  = results.filter(r => r.ok).length;
  const errCount = results.length - okCount;
  return NextResponse.json({ ok: errCount === 0, sent: okCount, failed: errCount, results });
}
