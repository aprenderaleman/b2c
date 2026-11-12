import { getTeacherById } from "./academy";
import { createNotification } from "./notifications";
import { sendTrialAssignedTeacherEmail } from "./email/send";
import { supabaseAdmin } from "./supabase";

export async function notifyTeacherOfTrial(opts: {
  teacherId: string;
  leadName: string;
  startIso: string;
  germanLevel: string | null;
  goal: string | null;
  classId: string;
}): Promise<void> {
  const teacher = await getTeacherById(opts.teacherId);
  if (!teacher) {
    console.error("[teacher-trial-notification] teacher not found:", opts.teacherId);
    return;
  }

  const sb = supabaseAdmin();

  // Idempotencia (Gelfis 2026-11-12): 1 solo aviso por trial y profe.
  // El insert con PK (class_id, user_id) actúa de lock: si la fila ya
  // existe (reintentos, dobles llamadas), no se repite ni el aviso
  // in-app ni el email. Se usa tabla propia porque notifications no
  // guarda fila para usuarios con opt-out (Sabine).
  const { error: lockErr } = await sb
    .from("trial_teacher_notices")
    .insert({ class_id: opts.classId, user_id: teacher.user_id });
  if (lockErr) {
    if (!/duplicate key|23505/i.test(lockErr.message)) {
      console.error("[teacher-trial-notification] lock insert failed:", lockErr.message);
    }
    return; // ya avisado (o error raro: mejor no arriesgar un duplicado)
  }

  // Excepción al opt-out global: profes con trial_email_optin=true
  // (Sabine) reciben ESTE email aunque tengan las notificaciones
  // apagadas.
  const { data: u } = await sb
    .from("users")
    .select("trial_email_optin")
    .eq("id", teacher.user_id)
    .maybeSingle();
  const bypassOptOut = Boolean((u as { trial_email_optin?: boolean } | null)?.trial_email_optin);

  const lang = teacher.language_preference ?? "es";
  const firstName = teacher.full_name?.split(" ")[0] ?? "Profesor/a";

  const startDate = formatDateForLang(opts.startIso, lang);

  const titleES = `Nueva clase de prueba — ${startDate}`;
  const titleDE = `Neue Probestunde — ${startDate}`;
  const bodyES = `Lead: ${opts.leadName}${opts.germanLevel ? ` · Nivel: ${opts.germanLevel}` : ""}`;
  const bodyDE = `Lead: ${opts.leadName}${opts.germanLevel ? ` · Niveau: ${opts.germanLevel}` : ""}`;

  await createNotification({
    user_id:  teacher.user_id,
    type:     "trial_assigned",
    title:    lang === "de" ? titleDE : titleES,
    body:     lang === "de" ? bodyDE : bodyES,
    link:     "/profesor/clasedeprueba",
    class_id: opts.classId,
  }).catch(e => console.error("[teacher-trial-notification] in-app failed:", e));

  await sendTrialAssignedTeacherEmail(teacher.email, {
    teacherFirstName: firstName,
    leadName:         opts.leadName,
    startDate,
    durationMin:      30,
    germanLevel:      opts.germanLevel,
    goal:             opts.goal,
    language:         lang,
  }, { bypassOptOut }).catch(e => console.error("[teacher-trial-notification] email failed:", e));
}

function formatDateForLang(iso: string, lang: "es" | "de"): string {
  const d = new Date(iso);
  const locale = lang === "de" ? "de-DE" : "es-ES";
  const dayName = d.toLocaleDateString(locale, { weekday: "long", timeZone: "Europe/Berlin" });
  const day = d.toLocaleDateString(locale, { day: "numeric", timeZone: "Europe/Berlin" });
  const month = d.toLocaleDateString(locale, { month: "long", timeZone: "Europe/Berlin" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", hour12: false });
  return `${dayName} ${day} de ${month}, ${time} (Berlín)`;
}
