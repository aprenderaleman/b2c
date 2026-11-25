/**
 * Prueba de punta a punta del botón "Asignar profe" (2026-11-25).
 *
 * Solo cuentas de prueba: alumno "Test" (hoy con la profe de prueba Julia Berger) y el perfil de profe de la
 * propia academia (Gelfis). Ida y vuelta: Test → Gelfis → Julia. Al final el alumno queda como estaba y se
 * borra todo lo creado (mensajes, avisos, registros). Solo corre sin proveedores de envío (no sale ningún email).
 */
import { supabaseAdmin } from "@/lib/supabase";
import { assignTeacherWithNotices, getAssignTeacherOptions, previewAssignTeacher } from "@/lib/assign-teacher";

const STUDENT = "52eb04c5-ee4d-4c27-a571-5942a145bb43", STUDENT_U = "c01696ad-2cc8-495a-9584-df015774ffd8";
const JULIA_T = "3d9b30b9-bb12-45ff-9f44-9e8a73ad3547", JULIA_U = "2bda539f-058f-46b6-876f-8bf5ddad8508";
const GELFIS_U = "889df284-dd16-41f3-a17c-64417524bbd8";
let pass = 0, fail = 0;
const check = (name: string, cond: unknown, extra?: unknown) => { if (cond) { pass++; console.log("  ✔", name); } else { fail++; console.log("  ✘", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); } };

(async () => {
  if (process.env.EVOLUTION_API_URL || process.env.RESEND_API_KEY) { console.error("ABORTO: hay proveedores de envío configurados."); process.exitCode = 2; return; }
  const sb = supabaseAdmin();
  const origLog = console.log;
  console.log = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.startsWith("[email") || s.startsWith("====")) return; origLog(...a); };
  const t0 = new Date(Date.now() - 2000).toISOString();
  const { data: gt } = await sb.from("teachers").select("id").eq("user_id", GELFIS_U).single();
  const GELFIS_T = (gt as { id: string }).id;
  const groupTeacher = async () => { const { data } = await sb.from("student_group_members").select("student_groups!inner(id, active, class_type, teacher_id)").eq("student_id", STUDENT).eq("student_groups.active", true); return (data as any)?.[0]?.student_groups; };
  const chatWith = async (uid: string) => { const { data: a } = await sb.from("chat_participants").select("chat_id, chats!inner(type)").eq("user_id", uid).eq("chats.type", "direct"); const { data: b } = await sb.from("chat_participants").select("chat_id").eq("user_id", GELFIS_U).in("chat_id", (a ?? []).map((x: any) => x.chat_id)); return (b as any)?.[0]?.chat_id as string | undefined; };
  const newMsgs = async (uid: string) => { const c = await chatWith(uid); if (!c) return []; const { data } = await sb.from("messages").select("id, content, sent_at").eq("chat_id", c).eq("author_id", GELFIS_U).gte("sent_at", t0).order("sent_at"); return (data ?? []) as Array<{ id: string; content: string }>; };

  const g0 = await groupTeacher();
  const stuChat = await chatWith(STUDENT_U);
  const { data: cp0 } = await sb.from("chat_participants").select("last_read_at").eq("chat_id", stuChat!).eq("user_id", STUDENT_U).single();
  const lastRead0 = (cp0 as any).last_read_at as string | null;
  console.log("estado inicial: profe del grupo =", g0?.teacher_id === JULIA_T ? "Julia Berger" : g0?.teacher_id, "| última lectura del alumno:", lastRead0);
  if (g0?.teacher_id !== JULIA_T) { console.error("ABORTO: el alumno de prueba no está con Julia; no toco nada."); process.exitCode = 2; return; }

  try {
    console.log("\nA) Opciones de la ventana");
    const opt = await getAssignTeacherOptions(STUDENT);
    check("profe actual = Julia Berger", opt?.currentTeacher?.fullName === "Julia Berger", opt?.currentTeacher);
    check("lista de profes con contador de alumnos", (opt?.teachers.length ?? 0) >= 5 && opt!.teachers.every(t => typeof t.activeStudents === "number"), opt?.teachers.length);
    const same = await previewAssignTeacher({ studentId: STUDENT, newTeacherId: JULIA_T });
    check("asignar al mismo profe → error claro", !same.ok && /ya está con Julia Berger/.test((same as any).error), same);

    console.log("\nB) Vista previa Test → Gelfis (no cambia nada)");
    const pv = await previewAssignTeacher({ studentId: STUDENT, newTeacherId: GELFIS_T, note: "Solo puede los martes por la tarde", includePhone: true });
    check("vista previa ok", pv.ok, pv);
    if (pv.ok) {
      check("aviso al profe anterior (Julia)", pv.preview.recipients.oldTeacher === "Julia Berger" && pv.preview.notices.toOldTeacher?.startsWith("Hola Julia! Te aviso: Test pasa con Gelfis Horn."), pv.preview.notices.toOldTeacher);
      check("sin comisión registrada → no se menciona", !pv.preview.notices.toOldTeacher?.includes("comisión"), pv.preview.notices.toOldTeacher);
      check("profe de la prueba = profe anterior → no hay tercer aviso", pv.preview.notices.toTrialTeacher === null);
      check("nota del admin en el mensaje al profe nuevo", pv.preview.notices.toNewTeacher.includes("• Solo puede los martes por la tarde") && pv.preview.notices.toNewTeacher.includes("Nivel A1, plan Estándar (8 clases al mes), meta A2"), pv.preview.notices.toNewTeacher);
      check("alumno que ya usa la plataforma → 'Un cambio en tus clases'", pv.preview.notices.toStudent.startsWith("¡Hola Test! Un cambio en tus clases: tu profesor/a será Gelfis Horn"), pv.preview.notices.toStudent);
    }
    check("la vista previa no movió el grupo", (await groupTeacher())?.teacher_id === JULIA_T);

    console.log("\nC) Asignar Test → Gelfis");
    let r = await assignTeacherWithNotices({ studentId: STUDENT, newTeacherId: GELFIS_T, actorUserId: GELFIS_U, note: "E2E ida" });
    check("ok", r.ok, r);
    check("grupo con el profe nuevo", (await groupTeacher())?.teacher_id === GELFIS_T);
    if (r.ok) check("avisados: profe anterior y alumno; la academia no se escribe a sí misma", r.sent.oldTeacher && r.sent.student && !r.sent.newTeacher && !r.sent.trialTeacher, r.sent);
    let jm = await newMsgs(JULIA_U), sm = await newMsgs(STUDENT_U);
    check("Julia recibió 1 mensaje", jm.length === 1 && jm[0].content.includes("Test pasa con Gelfis Horn"), jm.map(m => m.content));
    check("el alumno recibió 1 aviso", sm.length === 1 && sm[0].content.includes("tu profesor/a será Gelfis Horn"), sm.map(m => m.content));

    console.log("\nD) Asignar de vuelta Test → Julia (el aviso anterior sigue sin leer)");
    const pv2 = await previewAssignTeacher({ studentId: STUDENT, newTeacherId: JULIA_T });
    check("la vista previa anuncia que retirará 1 aviso sin leer", pv2.ok && pv2.preview.cleanup.unreadNoticesToDelete === 1, pv2.ok ? pv2.preview.cleanup : pv2);
    r = await assignTeacherWithNotices({ studentId: STUDENT, newTeacherId: JULIA_T, actorUserId: GELFIS_U, note: "Pidió clases por la mañana a las 7:00", includePhone: true });
    check("ok", r.ok, r);
    check("grupo de nuevo con Julia", (await groupTeacher())?.teacher_id === JULIA_T);
    if (r.ok) check("avisados: profe nuevo y alumno; retirado 1 aviso viejo", r.sent.newTeacher && r.sent.student && !r.sent.oldTeacher && r.cleanup.deleted === 1, r);
    jm = await newMsgs(JULIA_U); sm = await newMsgs(STUDENT_U);
    check("Julia tiene ahora 2 mensajes (el de salida y el de asignación)", jm.length === 2 && jm[1].content.startsWith(`Hola Julia! Te asigné a Test: ya aparece en "Mis estudiantes" y en tus chats.`) && jm[1].content.includes("• Pidió clases por la mañana a las 7:00"), jm.map(m => m.content));
    check("el alumno solo ve el aviso vigente (el viejo se retiró)", sm.length === 1 && sm[0].content.includes("tu profesor/a será Julia Berger"), sm.map(m => m.content));
    origLog("\n   Mensaje al profe nuevo:\n" + (jm[1]?.content ?? "").split("\n").map(l => "   | " + l).join("\n"));
    origLog("\n   Mensaje al alumno:\n" + (sm[0]?.content ?? "").split("\n").map(l => "   | " + l).join("\n"));

    console.log("\nE) Un mensaje ya leído no se toca");
    await sb.from("chat_participants").update({ last_read_at: new Date().toISOString() }).eq("chat_id", stuChat!).eq("user_id", STUDENT_U);
    const pv3 = await previewAssignTeacher({ studentId: STUDENT, newTeacherId: GELFIS_T });
    check("con el aviso ya leído, la limpieza no retira nada", pv3.ok && pv3.preview.cleanup.unreadNoticesToDelete === 0 && !pv3.preview.cleanup.welcomeWillBeFixed, pv3.ok ? pv3.preview.cleanup : pv3);
  } finally {
    console.log = origLog;
    console.log("\nLimpieza:");
    const del = async (label: string, p: PromiseLike<{ error: { message: string } | null; count: number | null }>) => { const { error, count } = await p; console.log(`  ${label}: ${error ? "ERROR " + error.message : (count ?? 0) + " borrados"}`); };
    const g = await groupTeacher();
    if (g && g.teacher_id !== JULIA_T) { await sb.from("student_groups").update({ teacher_id: JULIA_T }).eq("id", g.id); console.log("  grupo devuelto a Julia"); }
    for (const uid of [JULIA_U, STUDENT_U]) { const c = await chatWith(uid); if (c) await del(`mensajes de la prueba (${uid === JULIA_U ? "Julia" : "alumno"})`, sb.from("messages").delete({ count: "exact" }).eq("chat_id", c).eq("author_id", GELFIS_U).gte("sent_at", t0)); }
    await sb.from("chat_participants").update({ last_read_at: lastRead0 }).eq("chat_id", stuChat!).eq("user_id", STUDENT_U);
    await del("registros de reasignación", sb.from("teacher_reassignments").delete({ count: "exact" }).eq("student_id", STUDENT).gte("created_at", t0));
    await del("notificaciones de campana", sb.from("notifications").delete({ count: "exact" }).in("user_id", [JULIA_U, STUDENT_U, GELFIS_U]).gte("created_at", t0).in("title", ["Alumno reasignado", "Nuevo alumno asignado", "Nuevo profesor asignado"]));
    const gEnd = await groupTeacher();
    console.log("  profe final del alumno de prueba:", gEnd?.teacher_id === JULIA_T ? "Julia Berger (como al empezar)" : "DISTINTO → " + gEnd?.teacher_id);
    console.log(`\nemails reales enviados: 0 · RESULTADO: ${pass} correctos, ${fail} fallidos`);
    if (fail) process.exitCode = 1;
  }
})().catch(e => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
