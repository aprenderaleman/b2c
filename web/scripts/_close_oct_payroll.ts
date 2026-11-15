/**
 * Cierre nómina octubre 2026 (Gelfis 2026-11-01):
 *  1. Cancela la clase Veronica/Paola 04/10 (Veronica confirma que no se dio).
 *  2. Cierra la clase Thomas/Jeannete 12/10 (grabación de 52 min) como el cron
 *     auto-complete-recorded: completed + asistencia + log de horas.
 *  3. Genera los recibos PDF de octubre de todos los profes con nómina.
 */
import fs from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";
import { logClassHoursAndRollup } from "@/lib/finance";
import { buildTeacherInvoicePdf } from "@/lib/finance/teacher-invoice-pdf";

const PAOLA_0410  = "d0077072-2a35-4b7b-b829-11ad069bcd9a";
const THOMAS_1210 = "650bbfae-13f3-4b6a-b001-a90ab685035d";
const OUT = process.env.OUT_DIR ?? ".";
const DRY = process.env.DRY === "1";

(async () => {
  const sb = supabaseAdmin();

  // 1. Paola 04/10 → cancelada
  const { data: paola } = await sb.from("classes").select("id, status, notes_admin").eq("id", PAOLA_0410).maybeSingle();
  console.log("Paola 04/10 antes:", paola);
  if (!DRY && paola?.status === "scheduled") {
    const { error } = await sb.from("classes").update({
      status: "cancelled",
      notes_admin: `${paola.notes_admin ? paola.notes_admin + "\n" : ""}Cancelada en cierre de nómina: Veronica confirma que no se dio (2026-11-01)`,
    }).eq("id", PAOLA_0410).eq("status", "scheduled");
    console.log("Paola cancelada:", error ?? "ok");
  }

  // 2. Thomas 12/10 → completada con grabación como evidencia
  const { data: th } = await sb.from("classes")
    .select("id, status, teacher_id, scheduled_at, is_content_recording, recordings(status, duration_seconds)")
    .eq("id", THOMAS_1210).maybeSingle();
  console.log("Thomas 12/10 antes:", th);
  if (!DRY && th?.status === "scheduled") {
    const rec = (th.recordings as Array<{ status: string; duration_seconds: number | null }>).find(r => r.status === "ready");
    const minutes = Math.max(15, Math.min(240, Math.round((rec?.duration_seconds ?? 3000) / 60)));
    const start = new Date(th.scheduled_at as string).getTime();
    const endedAt = new Date(start + minutes * 60_000).toISOString();
    const { error: pErr } = await sb.from("class_participants").update({ attended: true }).eq("class_id", THOMAS_1210);
    const { error: uErr } = await sb.from("classes").update({
      status: "completed", started_at: th.scheduled_at, ended_at: endedAt, actual_duration_minutes: minutes,
      notes_admin: `Cerrada en cierre de nómina: grabación de ${minutes} min, el profe no pulsó Terminar (2026-11-01)`,
    }).eq("id", THOMAS_1210).eq("status", "scheduled");
    console.log("Thomas update:", pErr ?? uErr ?? "ok", "minutos:", minutes);
    if (!pErr && !uErr) {
      await logClassHoursAndRollup({ classId: THOMAS_1210, teacherId: th.teacher_id as string, durationMinutes: minutes });
      console.log("Thomas log horas: ok");
    }
  }

  // 3. PDFs
  const { data: te } = await sb.from("teacher_earnings")
    .select("teacher_id, amount_cents, classes_count, teacher:teachers!inner(user:users!inner(full_name, role))")
    .eq("month", "2026-10-01");
  for (const row of ((te ?? []) as unknown) as Array<{ teacher_id: string; amount_cents: number; classes_count: number; teacher: { user: { full_name: string; role: string } } }>) {
    const u = Array.isArray(row.teacher) ? (row.teacher as unknown as Array<{ user: { full_name: string; role: string } }>)[0].user : row.teacher.user;
    const user = Array.isArray(u) ? u[0] : u;
    if (user.role !== "teacher") continue;
    const inv = await buildTeacherInvoicePdf({ teacherId: row.teacher_id, month: "2026-10" });
    const file = path.join(OUT, inv.filename);
    fs.writeFileSync(file, inv.pdfBuffer);
    const match = inv.totalCents === row.amount_cents ? "CUADRA" : `NO CUADRA (earnings ${(row.amount_cents / 100).toFixed(2)})`;
    console.log(`${user.full_name}: PDF ${(inv.totalCents / 100).toFixed(2)} € · ${inv.classesCount} clases · ${match} → ${file}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
