import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { issueCertificateManually } from "@/lib/certificates";

/**
 * POST /api/admin/students/[id]/certificates
 *
 * Admin-only: manually issue a certificate (e.g. "exam_passed — Goethe B2").
 */
const Body = z.object({
  type:       z.enum(["classes_50", "classes_100", "level_a2", "level_b1", "level_b2", "level_c1", "exam_passed"]),
  extraLabel: z.string().trim().max(200).nullable().default(null),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: studentId } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const cert = await issueCertificateManually({
      studentId,
      type:       parsed.data.type,
      extraLabel: parsed.data.extraLabel,
      issuedBy:   (session.user as { id: string }).id,
    });
    if (!cert) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ ok: true, certificate: cert });
  } catch (e) {
    return NextResponse.json(
      { error: "issue_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
