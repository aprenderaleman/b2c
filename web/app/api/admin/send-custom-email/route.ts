import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendRaw } from "@/lib/email/send";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (bearer && cronSecret && bearer === cronSecret) {
    // trusted
  } else {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "superadmin")
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { recipients } = (await req.json()) as {
    recipients: Array<{ to: string; subject: string; html: string; text: string }>;
  };

  if (!recipients?.length) return NextResponse.json({ error: "no_recipients" }, { status: 400 });

  const results: Array<{ to: string; ok: boolean }> = [];
  for (const r of recipients) {
    const res = await sendRaw(r.to, r.subject, r.html, r.text);
    results.push({ to: r.to, ok: res.ok });
  }

  return NextResponse.json({ ok: true, results });
}
