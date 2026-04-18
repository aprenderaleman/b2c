import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToBucket } from "@/lib/storage";

/**
 * POST /api/chat/upload
 *
 * multipart/form-data with a single `file` field. Uploads to the
 * chat-uploads bucket and returns the metadata the ChatShell will
 * pass back into /api/chat/[id]/messages as an attachment.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "invalid_form" }, { status: 400 }); }

  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  try {
    const uploaded = await uploadToBucket(
      "chat-uploads",
      (session.user as { id: string }).id,
      file,
      file.name,
    );
    return NextResponse.json({
      ok:           true,
      url:          uploaded.url,
      name:         uploaded.name,
      size:         uploaded.size,
      content_type: uploaded.content_type,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "upload_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
