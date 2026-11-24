/**
 * Prueba de punta a punta del "Reagendar con motivo" del profe (2026-11-24).
 *
 * Usa el lead de prueba "test" (cold, sept 2026) y a la profe de prueba Julia
 * Berger. Crea clases de prueba ficticias, ejecuta cada caso contra la BD real
 * y al terminar BORRA todo lo creado y RESTAURA el lead tal como estaba.
 * Solo corre si NO hay proveedores de envío configurados (sin Evolution ni
 * Resend): así ningún WhatsApp ni email sale de verdad.
 */
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherRescheduleStatus, teacherRescheduleTrial } from "@/lib/teacher-reschedule";

const LEAD = "5dfcf673-ba29-4865-91e5-f2743d8bbb94";
const JULIA_TEACHER = "3d9b30b9-bb12-45ff-9f44-9e8a73ad3547";
const JULIA_USER = { id: "2bda539f-058f-46b6-876f-8bf5ddad8508", email: "julia@test.invalid", role: "teacher" };
const NOTE = "E2E: se me cruza con otra clase a esa hora";

let pass = 0, fail = 0;
const check = (name: string, cond: unknown, extra?: unknown) => {
  if (cond) { pass++; console.log("  ✔", name); }
  else { fail++; console.log("  ✘", name, extra !== undefined ? JSON.stringify(extra) : ""); }
};

(async () => {
  if (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_API_KEY || process.env.RESEND_API_KEY) {
    console.error("ABORTO: hay proveedores de envío configurados en este entorno; la prueba podría enviar mensajes reales.");
    process.exitCode = 2; return;
  }
  const sb = supabaseAdmin();
  const t0 = new Date(Date.now() - 2000).toISOString();
  const waCaptured: string[] = [];
  const origWarn = console.warn, origLog = console.log;
  console.warn = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.includes("Would have sent") || s.includes("message not sent")) waCaptured.push(a.slice(1).map(String).join(" | ")); };
  const emailCaptured: string[] = [];
  console.log = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.startsWith("[email DEV]") || s.startsWith("====")) { emailCaptured.push(s); return; } origLog(...a); };

  const { data: leadBefore } = await sb.from("leads").select("*").eq("id", LEAD).single();
  const { data: chainsBefore } = await sb.from("lead_chains").select("id").eq("lead_id", LEAD).is("completed_at", null);
  const { data: fuBefore } = await sb.from("post_trial_followups").select("id").eq("lead_id", LEAD);
  console.log("lead de prueba:", (leadBefore as any).name, "| estado:", (leadBefore as any).status, "| cadenas activas:", chainsBefore?.length ?? 0, "| followups previos:", fuBefore?.length ?? 0);
  if ((chainsBefore?.length ?? 0) > 0) { console.error("ABORTO: el lead de prueba tiene una cadena activa; no la toco."); process.exitCode = 2; return; }

  const created: string[] = [];
  const mkClass = async (minutesFromNow: number) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await sb.from("classes").insert({
      type: "individual", teacher_id: JULIA_TEACHER, lead_id: LEAD, is_trial: true, status: "scheduled",
      scheduled_at: new Date(Date.now() + minutesFromNow * 60_000).toISOString(), duration_minutes: 40,
      title: "E2E reagendar — clase ficticia (se borra sola)", notes_admin: "E2E reagendar",
      notify_after_at: nowIso, notified_at: nowIso, billed_hours: 0,
    }).select("id, scheduled_at").single();
    if (error) throw new Error("no pude crear la clase ficticia: " + error.message);
    created.push((data as any).id);
    return data as { id: string; scheduled_at: string };
  };
  const cls = async (id: string) => (await sb.from("classes").select("status, notes_admin, scheduled_at").eq("id", id).single()).data as any;
  const run = (reason?: unknown, note?: unknown, user = JULIA_USER) => teacherRescheduleTrial({ leadId: LEAD, user, reason, note });

  try {
    // ── Caso A: clase dentro de 5 h, sin nota de voz ─────────────────────────
    origLog("\nA) Clase en 5 h, sin nota de voz");
    const c1 = await mkClass(300);
    let st = await getTeacherRescheduleStatus(LEAD);
    check("estado: hay clase futura", st.hasUpcomingTrial && st.scheduledAt === c1.scheduled_at, st);
    check("estado: 'Lead no confirmó' bloqueado por falta de nota de voz", !st.noConfirm.allowed && st.noConfirm.blockedBy === "no_voice_note", st.noConfirm);
    let r = await run("lead_no_confirmo");
    check("POST rechazado (400, no_voice_note)", r.status === 400 && r.body.blockedBy === "no_voice_note", r);
    check("la clase sigue agendada", (await cls(c1.id)).status === "scheduled");

    r = await run();
    check("profe sin motivo → 400", r.status === 400 && String(r.body.reason).includes("Elige el motivo"), r);
    r = await run("otro_motivo");
    check("motivo inventado → 400", r.status === 400 && String(r.body.reason).includes("no válido"), r);
    r = await run("profe_no_puede", "  ");
    check("'No puedo dar la clase' sin texto → 400", r.status === 400 && String(r.body.reason).includes("Escribe el motivo"), r);
    check("la clase sigue agendada tras los rechazos", (await cls(c1.id)).status === "scheduled");

    // ── Caso B: nota de voz marcada, pero faltan 5 h ─────────────────────────
    origLog("\nB) Nota de voz marcada, faltan 5 h");
    const { error: sErr } = await sb.from("trial_class_scripts").insert({ class_id: c1.id, lead_id: LEAD, teacher_id: JULIA_USER.id, current_step: 0, voice_note_sent_at: new Date().toISOString() });
    if (sErr) throw new Error("no pude marcar la nota de voz: " + sErr.message);
    st = await getTeacherRescheduleStatus(LEAD);
    check("estado: bloqueado por 'demasiado pronto' con la hora de apertura", st.noConfirm.blockedBy === "too_early" && /a partir de las \d{2}:\d{2}/.test(st.noConfirm.message ?? ""), st.noConfirm);
    r = await run("lead_no_confirmo");
    check("POST rechazado (400, too_early)", r.status === 400 && r.body.blockedBy === "too_early", r);

    // ── Caso C: dentro de las 2 h pero el lead confirmó ──────────────────────
    origLog("\nC) Faltan 45 min, pero el lead confirmó");
    await sb.from("classes").update({ scheduled_at: new Date(Date.now() + 45 * 60_000).toISOString(), student_confirmed_at: new Date().toISOString(), student_confirmed_source: "student_web" }).eq("id", c1.id);
    r = await run("lead_no_confirmo");
    check("confirmó en la clase (web/WA/setter) → 400 confirmed", r.status === 400 && r.body.blockedBy === "confirmed", r);
    await sb.from("classes").update({ student_confirmed_at: null, student_confirmed_source: null }).eq("id", c1.id);
    await sb.from("leads").update({ trial_confirmed_at: new Date().toISOString() }).eq("id", LEAD);
    r = await run("lead_no_confirmo");
    check("confirmó en el lead → 400 confirmed", r.status === 400 && r.body.blockedBy === "confirmed", r);
    await sb.from("leads").update({ trial_confirmed_at: null }).eq("id", LEAD);
    check("la clase sigue agendada", (await cls(c1.id)).status === "scheduled");

    // ── Caso D: todo en regla → reagenda por falta de confirmación ───────────
    origLog("\nD) Faltan 45 min, sin confirmar, nota de voz marcada → se permite");
    st = await getTeacherRescheduleStatus(LEAD);
    check("estado: 'Lead no confirmó' permitido", st.noConfirm.allowed && st.noConfirm.blockedBy === null, st.noConfirm);
    waCaptured.length = 0;
    r = await run("lead_no_confirmo");
    check("POST 200", r.status === 200 && r.body.ok === true && r.body.rescheduleReason === "lead_no_confirmo", r);
    let c = await cls(c1.id);
    check("clase cancelada", c.status === "cancelled", c);
    check("la clase guarda el motivo", /Reagendada por .+ — motivo: lead no confirmó/.test(c.notes_admin ?? ""), c.notes_admin);
    let { data: l } = await sb.from("leads").select("status, reschedule_state, trial_scheduled_at").eq("id", LEAD).single();
    check("lead en 'Reagendando'", (l as any).status === "rescheduling" && (l as any).reschedule_state?.source === "teacher", l);
    let { data: tl } = await sb.from("lead_timeline").select("content, metadata").eq("lead_id", LEAD).gte("timestamp", t0).filter("metadata->>kind", "eq", "trial_cancelled_for_reschedule").order("timestamp", { ascending: false }).limit(1);
    check("historial con el motivo", (tl?.[0] as any)?.metadata?.reschedule_reason === "lead_no_confirmo" && String((tl?.[0] as any)?.content).includes("motivo: lead no confirmó"), tl?.[0]);
    check("mensaje al lead = copy 'no confirmó'", waCaptured.some(w => w.includes("Te escribimos para confirmar tu clase de prueba del")), waCaptured);
    origLog("     inicio del WhatsApp que habría salido:", JSON.stringify((waCaptured[0] ?? "").split(" | ").pop()));
    let { data: fu } = await sb.from("post_trial_followups").select("*").eq("lead_id", LEAD).gte("created_at", t0);
    check("seguimiento +24 h programado (como antes)", (fu ?? []).some((f: any) => f.kind === "reagendar"), fu);
    let { data: lc } = await sb.from("lead_contacts").select("note").eq("lead_id", LEAD).gte("created_at", t0).order("created_at", { ascending: false }).limit(1);
    check("contacto registrado con el motivo", String((lc?.[0] as any)?.note).includes("el lead no confirmó"), lc?.[0]);

    // ── Caso E: el profe no puede dar la clase ───────────────────────────────
    origLog("\nE) 'No puedo dar la clase' con motivo escrito (clase mañana, sin nota de voz)");
    await sb.from("leads").update({ status: "trial_scheduled" }).eq("id", LEAD);
    const c2 = await mkClass(26 * 60);
    waCaptured.length = 0;
    r = await run("profe_no_puede", `  ${NOTE}  `);
    check("POST 200 sin exigir nota de voz ni ventana de 1 h", r.status === 200 && r.body.rescheduleReason === "profe_no_puede", r);
    c = await cls(c2.id);
    check("clase cancelada", c.status === "cancelled", c);
    check("la clase guarda el motivo escrito", String(c.notes_admin).includes("el profe no puede dar la clase") && String(c.notes_admin).includes(NOTE), c.notes_admin);
    check("mensaje al lead = copy de disculpa con el nombre del profe", waCaptured.some(w => w.includes("Te pedimos disculpas: Julia no podrá darte la clase de prueba del")), waCaptured);
    check("el motivo del profe NO va en el mensaje al lead", !waCaptured.some(w => w.includes("se me cruza")), waCaptured);
    origLog("     inicio del WhatsApp que habría salido:", JSON.stringify((waCaptured[0] ?? "").split(" | ").pop()));
    ({ data: tl } = await sb.from("lead_timeline").select("content, metadata").eq("lead_id", LEAD).gte("timestamp", t0).filter("metadata->>kind", "eq", "trial_cancelled_for_reschedule").order("timestamp", { ascending: false }).limit(1));
    check("historial con motivo y texto", (tl?.[0] as any)?.metadata?.reschedule_reason === "profe_no_puede" && (tl?.[0] as any)?.metadata?.reschedule_note === NOTE, tl?.[0]);
    const { data: adminNotifs } = await sb.from("notifications").select("user_id, title, body, link").gte("created_at", t0).ilike("title", "Julia no puede dar la prueba de%");
    check("aviso a los admins con el motivo", (adminNotifs?.length ?? 0) >= 1 && String((adminNotifs?.[0] as any)?.body).includes(NOTE) && (adminNotifs?.[0] as any)?.link === `/admin/leads/${LEAD}`, adminNotifs);
    origLog("     aviso al admin:", JSON.stringify({ title: (adminNotifs?.[0] as any)?.title, body: (adminNotifs?.[0] as any)?.body }));

    // ── Caso F: sin clase futura ─────────────────────────────────────────────
    origLog("\nF) Sin clase futura");
    r = await run("lead_no_confirmo");
    check("→ 400 no_upcoming_trial", r.status === 400 && r.body.blockedBy === "no_upcoming_trial", r);
    st = await getTeacherRescheduleStatus(LEAD);
    check("estado: sin clase futura", !st.hasUpcomingTrial && st.noConfirm.blockedBy === "no_upcoming_trial", st);
  } finally {
    console.warn = origWarn; console.log = origLog;
    console.log("\nLimpieza:");
    const del = async (label: string, p: PromiseLike<{ error: { message: string } | null; count: number | null }>) => { const { error, count } = await p; console.log(`  ${label}: ${error ? "ERROR " + error.message : (count ?? 0) + " borrados"}`); };
    if (created.length) {
      await del("notas de voz ficticias", sb.from("trial_class_scripts").delete({ count: "exact" }).in("class_id", created));
      await del("avisos ligados a las clases", sb.from("notifications").delete({ count: "exact" }).in("class_id", created));
    }
    await del("avisos a admins de la prueba", sb.from("notifications").delete({ count: "exact" }).gte("created_at", t0).ilike("title", "Julia no puede dar la prueba de%"));
    await del("seguimientos programados", sb.from("post_trial_followups").delete({ count: "exact" }).eq("lead_id", LEAD).gte("created_at", t0));
    await del("contactos registrados", sb.from("lead_contacts").delete({ count: "exact" }).eq("lead_id", LEAD).gte("created_at", t0));
    await del("historial del lead", sb.from("lead_timeline").delete({ count: "exact" }).eq("lead_id", LEAD).gte("timestamp", t0));
    if (created.length) await del("clases ficticias", sb.from("classes").delete({ count: "exact" }).in("id", created));
    // Restaurar el lead exactamente como estaba (todas las columnas que hayan cambiado).
    const { data: leadAfter } = await sb.from("leads").select("*").eq("id", LEAD).single();
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(leadBefore as Record<string, unknown>)) if (JSON.stringify(v) !== JSON.stringify((leadAfter as any)[k])) patch[k] = v;
    if (Object.keys(patch).length) { const { error } = await sb.from("leads").update(patch).eq("id", LEAD); console.log("  lead restaurado:", error ? "ERROR " + error.message : Object.keys(patch).join(", ")); }
    const { data: leadFinal } = await sb.from("leads").select("*").eq("id", LEAD).single();
    const diff = Object.keys(leadBefore as object).filter(k => k !== "updated_at" && JSON.stringify((leadBefore as any)[k]) !== JSON.stringify((leadFinal as any)[k]));
    console.log("  lead igual que al empezar:", diff.length === 0 ? "sí" : "NO → " + diff.join(", "));
    const { count: leftCls } = await sb.from("classes").select("id", { count: "exact", head: true }).in("id", created.length ? created : ["00000000-0000-0000-0000-000000000000"]);
    const { count: leftFu } = await sb.from("post_trial_followups").select("id", { count: "exact", head: true }).eq("lead_id", LEAD);
    const { count: leftChains } = await sb.from("lead_chains").select("id", { count: "exact", head: true }).eq("lead_id", LEAD).is("completed_at", null);
    console.log("  restos → clases:", leftCls, "| seguimientos:", leftFu, "(antes", fuBefore?.length ?? 0, ") | cadenas activas:", leftChains);
    console.log(`\nemails reales enviados: 0 (modo DEV, ${emailCaptured.filter(e => e.includes("to=")).length} simulados) · WhatsApp reales: 0`);
    console.log(`RESULTADO: ${pass} correctos, ${fail} fallidos`);
    if (fail) process.exitCode = 1;
  }
})().catch(e => { console.error("ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
