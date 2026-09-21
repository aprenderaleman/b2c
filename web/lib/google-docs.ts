import { supabaseAdmin } from "./supabase";
import { getAdminDriveAccessToken } from "./admin-google-drive";

const APUNTES_FOLDER_ID = "1CcbMuHxOZtcj6TB8-DI6C9I2-88op0s2";

type DocResult = { id: string; url: string } | null;

/**
 * Crea "Apuntes de Clase - <alumno>" en la carpeta de Apuntes y lo comparte
 * con el profe. Preferimos el Drive del admin (OAuth, dueño = Gelfis);
 * la service account queda como fallback (desde sept 2026 Google no le da
 * almacenamiento: "storage quota has been exceeded").
 */
export async function createStudentNotesDoc(
  studentName: string,
  level: string,
  teacherName: string,
  shareWithEmail: string | null,
): Promise<DocResult> {
  const adminToken = await getAdminDriveAccessToken();
  if (adminToken) {
    try {
      const { OAuth2Client } = await import("google-auth-library");
      const { drive } = await import("@googleapis/drive");
      const auth = new OAuth2Client();
      auth.setCredentials({ access_token: adminToken });
      const driveApi = drive({ version: "v3", auth });
      const created = await driveApi.files.create({
        requestBody: {
          name: `Apuntes de Clase - ${studentName}`,
          mimeType: "application/vnd.google-apps.document",
          parents: [APUNTES_FOLDER_ID],
        },
      });
      const fileId = created.data.id;
      if (fileId) {
        if (shareWithEmail) {
          await driveApi.permissions.create({
            fileId,
            sendNotificationEmail: false,
            requestBody: { type: "user", role: "writer", emailAddress: shareWithEmail },
          }).catch(e => console.warn("[google-docs] share with teacher failed:", e instanceof Error ? e.message : e));
        }
        lastDocsError = null;
        return { id: fileId, url: `https://docs.google.com/document/d/${fileId}/edit` };
      }
    } catch (e) {
      lastDocsError = `admin drive: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[google-docs] admin Drive create failed, probando service account:", lastDocsError);
    }
  }

  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    lastDocsError = "GOOGLE_SERVICE_ACCOUNT_JSON no definida";
    console.warn("[google-docs] GOOGLE_SERVICE_ACCOUNT_JSON not set, skipping doc creation");
    return null;
  }

  let parsed: { client_email?: string; private_key?: string };
  try { parsed = JSON.parse(json); } catch {
    lastDocsError = `GOOGLE_SERVICE_ACCOUNT_JSON no es JSON válido (len=${json.length}, empieza "${json.slice(0, 12)}")`;
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) {
    lastDocsError = `GOOGLE_SERVICE_ACCOUNT_JSON sin client_email/private_key (claves: ${Object.keys(parsed).join(",")})`;
    return null;
  }

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
    lastDocsError = e instanceof Error ? e.message : String(e);
    console.error("[google-docs] createStudentNotesDoc failed:", lastDocsError);
    return null;
  }
}

/** Último error de Drive (para que el cron docs-backfill lo muestre en su respuesta). */
export let lastDocsError: string | null = null;

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
