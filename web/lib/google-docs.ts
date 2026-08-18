import { supabaseAdmin } from "./supabase";

const APUNTES_FOLDER_ID = "1CcbMuHxOZtcj6TB8-DI6C9I2-88op0s2";

type DocResult = { id: string; url: string } | null;

export async function createStudentNotesDoc(
  studentName: string,
  level: string,
  teacherName: string,
  shareWithEmail: string | null,
): Promise<DocResult> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    console.warn("[google-docs] GOOGLE_SERVICE_ACCOUNT_JSON not set, skipping doc creation");
    return null;
  }

  let parsed: { client_email?: string; private_key?: string };
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed.client_email || !parsed.private_key) return null;

  const { JWT } = await import("google-auth-library");
  const { drive } = await import("@googleapis/drive");
  const privateKey = parsed.private_key.replace(/\\n/g, "\n");
  const auth = new JWT({
    email: parsed.client_email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const driveApi = drive({ version: "v3", auth });

  try {
    const created = await driveApi.files.create({
      requestBody: {
        name: `Apuntes de Clase - ${studentName}`,
        mimeType: "application/vnd.google-apps.document",
        parents: [APUNTES_FOLDER_ID],
      },
    });

    const fileId = created.data.id;
    if (!fileId) return null;

    if (shareWithEmail) {
      await driveApi.permissions.create({
        fileId,
        sendNotificationEmail: false,
        requestBody: { type: "user", role: "writer", emailAddress: shareWithEmail },
      });
    }

    const url = `https://docs.google.com/document/d/${fileId}/edit`;
    return { id: fileId, url };
  } catch (e) {
    console.error("[google-docs] createStudentNotesDoc failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getTeacherEmail(teacherId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("teachers")
    .select("users!inner(email)")
    .eq("id", teacherId)
    .maybeSingle();
  if (!data) return null;
  return (data as unknown as { users: { email: string } }).users.email;
}
