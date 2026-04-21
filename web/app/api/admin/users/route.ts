import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { sendWelcomeStaffEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/users
 *
 * Creates a new user with role=admin. Only callable by superadmin.
 * Creating teachers goes through /api/admin/teachers instead because
 * it also inserts a `teachers` row with economic profile.
 */

const Body = z.object({
  email:     z.string().trim().toLowerCase().email(),
  fullName:  z.string().trim().min(2).max(120),
  phone:     z.string().trim().max(30).nullable().default(null),
  language:  z.enum(["es", "de"]).default("es"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only superadmin can mint new admins. Verify against the users table
  // so the env-var fallback session (which is superadmin) also passes.
  const sb = supabaseAdmin();
  const callerEmail = session.user.email?.trim().toLowerCase();
  if (!callerEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: caller } = await sb.from("users").select("role").eq("email", callerEmail).maybeSingle();
  const callerRole = (caller?.role as string | undefined) ?? (session.user as { role?: string }).role;
  if (callerRole !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  let created;
  try {
    created = await createUser({
      email:    body.email,
      fullName: body.fullName,
      phone:    body.phone,
      language: body.language,
      role:     "admin",
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

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const emailResult = await sendWelcomeStaffEmail(body.email, {
    name:          body.fullName.split(/\s+/)[0] || body.fullName,
    email:         body.email,
    tempPassword:  created.tempPassword,
    platformUrl,
    role:          "admin",
    language:      body.language,
  });

  return NextResponse.json({
    ok:           true,
    userId:       created.userId,
    emailSent:    emailResult.ok,
    tempPassword: emailResult.ok ? null : created.tempPassword,
  });
}
