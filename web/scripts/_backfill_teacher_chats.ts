/**
 * Gelfis 2026-11-20: Sina no podía escribir a Doris porque el chat profe–alumno no existía
 * (solo se creaba al reasignar o al agendar la primera clase). Asegura el chat directo de
 * cada alumno activo con el profe de su grupo individual activo. Idempotente.
 * Uso:  npx tsx … scripts/_backfill_teacher_chats.ts [--apply]
 */
import { supabaseAdmin } from "@/lib/supabase";
import { ensureDirectChat } from "@/lib/chat";
const APPLY = process.argv.includes("--apply");

(async () => {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("student_group_members")
    .select("student_id, students!inner(user_id, subscription_status, users!inner(full_name, active)), student_groups!inner(active, class_type, capacity, teachers!inner(user_id, users!inner(full_name, active, role)))")
    .eq("student_groups.active", true)
    .in("students.subscription_status", ["active", "paused"])
    .eq("students.users.active", true);
  if (error) throw error;
  type Row = { student_id: string; students: { user_id: string; users: { full_name: string } }; student_groups: { class_type: string; capacity: number | null; teachers: { user_id: string; users: { full_name: string; active: boolean; role: string } } } };
  const pairs = ((data ?? []) as unknown as Row[]).filter(r => (r.student_groups.class_type === "individual" || r.student_groups.capacity === 1) && r.student_groups.teachers.users.active && r.student_groups.teachers.users.role === "teacher");
  console.log("parejas profe–alumno (grupo individual activo):", pairs.length);

  let missing = 0;
  for (const r of pairs) {
    const tU = r.student_groups.teachers.user_id, sU = r.students.user_id;
    const { data: parts } = await sb.from("chat_participants").select("chat_id, user_id, chats!inner(type)").in("user_id", [tU, sU]).eq("chats.type", "direct");
    const counts: Record<string, number> = {};
    for (const p of parts ?? []) counts[p.chat_id] = (counts[p.chat_id] ?? 0) + 1;
    const exists = Object.values(counts).some(n => n >= 2);
    if (exists) continue;
    missing++;
    const label = `${r.student_groups.teachers.users.full_name.split(" ")[0]} ↔ ${r.students.users.full_name}`;
    if (!APPLY) { console.log("  FALTA chat:", label); continue; }
    const chatId = await ensureDirectChat(tU, sU);
    console.log("  creado:", label, chatId);
  }
  console.log(APPLY ? `creados: ${missing}` : `faltan: ${missing} (ejecutar con --apply para crearlos)`);
})().catch(e => { console.error(e); process.exit(1); });
