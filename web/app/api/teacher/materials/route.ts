import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { uploadToBucket } from "@/lib/storage";
import { createMaterial } from "@/lib/materials";

/**
 * POST /api/teacher/materials
 *
 * multipart/form-data body:
 *   file         — required
 *   title        — required
 *   description  — optional
 *   tags         — comma-separated string, optional
 *   visibility   — "private" | "shared"  (default "private")
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const me = role === "teacher" ? await getTeacherByUserId((session.user as { id: string }).id) : null;
  if (role === "teacher" && !me) {
    return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "invalid_form" }, { status: 400 }); }

  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim() || null;
  const tagsRaw = String(form.get("tags") ?? "").trim();
  const visibility = (String(form.get("visibility") ?? "private") === "shared" ? "shared" : "private") as "private" | "shared";
  // Admin creating on behalf of a teacher:
  const targetTeacherId = (role === "teacher" ? me?.id : String(form.get("teacherId") ?? "")) ?? "";

  if (!file || !title || !targetTeacherId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const tags = tagsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);

  try {
    const uploaded = await uploadToBucket("materials", targetTeacherId, file, file.name);
    const id = await createMaterial({
      teacherId:   targetTeacherId,
      title,
      description,
      storagePath: uploaded.path,
      fileUrl:     uploaded.url,
      fileName:    uploaded.name,
      fileType:    uploaded.content_type,
      fileSize:    uploaded.size,
      tags,
      visibility,
    });
    return NextResponse.json({ ok: true, id, url: uploaded.url });
  } catch (e) {
    return NextResponse.json(
      { error: "upload_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
