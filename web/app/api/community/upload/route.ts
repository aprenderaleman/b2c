import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToBucket } from "@/lib/storage";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP and GIF are allowed" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Max 5 MB" }, { status: 400 });
  }

  const uploaded = await uploadToBucket("comunidad", userId, file, file.name);
  return NextResponse.json({
    url: uploaded.url,
    path: uploaded.path,
  });
}
