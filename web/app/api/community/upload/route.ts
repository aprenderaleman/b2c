import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToBucket } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_SIZE = 4 * 1024 * 1024; // 4 MB (fits within Vercel's ~4.5 MB body limit)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Archivo demasiado grande (max 4 MB)" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP and GIF are allowed" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Max 5 MB" }, { status: 400 });
  }

  try {
    const uploaded = await uploadToBucket("comunidad", userId, file, file.name);
    return NextResponse.json({
      url: uploaded.url,
      path: uploaded.path,
    });
  } catch (err) {
    console.error("[community/upload] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 },
    );
  }
}
