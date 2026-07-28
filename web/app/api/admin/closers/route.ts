import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { sendWelcomeStaffEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().default(null),
  language: z.enum(["es", "de"]).default("es"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("users")
    .select("id, email, full_name, phone, active, rango, created_at")
    .eq("role", "closer")
    .order("created_at", { ascending: false });

  return NextResponse.json({ closers: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  let created;
  try {
    created = await createUser({
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      language: parsed.data.language,
      role: "closer",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "email_already_in_use", message: "Ese correo ya pertenece a otro usuario." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }

  const sb = supabaseAdmin();
  await sb.from("users").update({ rango: "rookie" }).eq("id", created.userId);

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const emailResult = await sendWelcomeStaffEmail(parsed.data.email, {
    name: parsed.data.fullName.split(/\s+/)[0] || parsed.data.fullName,
    email: parsed.data.email,
    tempPassword: created.tempPassword,
    platformUrl,
    role: "admin",
    language: parsed.data.language,
  });

  return NextResponse.json({
    ok: true,
    userId: created.userId,
    emailSent: emailResult.ok,
    tempPassword: emailResult.ok ? null : created.tempPassword,
  });
}
