"use server";

import { auth } from "@/lib/auth";
import { upsertTemplate } from "@/lib/message-stats";
import { revalidatePath } from "next/cache";

/**
 * Guarda / actualiza una plantilla. Solo superadmin / admin.
 */
export async function saveTemplateAction(input: {
  kind:         string;
  sub_n:        number | null;
  channel:      "whatsapp" | "email" | "both";
  name:         string;
  description:  string | null;
  body:         string;
  placeholders: string[];
  active:       boolean;
}): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    throw new Error("forbidden");
  }
  const editor = session.user.email ?? session.user.name ?? "unknown";
  await upsertTemplate({ ...input, updatedBy: editor });
  revalidatePath("/admin/mensajes");
}
