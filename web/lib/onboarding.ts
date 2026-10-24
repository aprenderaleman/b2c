import { supabaseAdmin } from "@/lib/supabase";

/**
 * Onboarding (tour guiado + lista "Primeros pasos") para alumnos y profes
 * (Gelfis 2026-10-24). El estado vive en students.onboarding /
 * teachers.onboarding (jsonb: evento → timestamp ISO). Los pasos que se
 * pueden deducir de otros datos (chat, asistencia…) se calculan aquí.
 */
export type OnboardingRole = "student" | "teacher";
export type Lang = "es" | "de";

export type TourStep = {
  /** data-tour="<anchor>" del elemento a señalar; sin ancla → centrado. */
  anchor: string | null;
  title: string;
  body: string;
};
export type ChecklistItem = {
  key: string;
  label: string;
  hint: string;
  href: string | null;
  done: boolean;
};
export type OnboardingState = {
  showTour: boolean;
  showChecklist: boolean;
  checklist: ChecklistItem[];
  tourSteps: TourStep[];
  lang: Lang;
};

export const STUDENT_EVENTS = ["tour_seen", "tour_dismissed", "checklist_dismissed", "cursos", "schule", "hans", "asistente"] as const;
export const TEACHER_EVENTS = ["tour_seen", "tour_dismissed", "checklist_dismissed", "disponibilidad", "guia", "guion", "asistente", "aula"] as const;

type Events = Record<string, string>;

const CHECKLIST_DAYS = 14;
const NEW_SINCE = "2026-10-10"; // alumnos/profes anteriores no ven la lista

export async function recordOnboardingEvent(role: OnboardingRole, id: string, event: string): Promise<void> {
  const allowed: readonly string[] = role === "student" ? STUDENT_EVENTS : TEACHER_EVENTS;
  if (!allowed.includes(event)) return;
  const sb = supabaseAdmin();
  const table = role === "student" ? "students" : "teachers";
  const { data } = await sb.from(table).select("onboarding").eq("id", id).maybeSingle();
  const cur = ((data as { onboarding?: Events } | null)?.onboarding ?? {}) as Events;
  if (cur[event]) return;                                   // idempotente
  await sb.from(table).update({ onboarding: { ...cur, [event]: new Date().toISOString() } }).eq("id", id);
}

export async function recordOnboardingEventByUser(role: OnboardingRole, userId: string, event: string): Promise<void> {
  const sb = supabaseAdmin();
  const table = role === "student" ? "students" : "teachers";
  const { data } = await sb.from(table).select("id").eq("user_id", userId).maybeSingle();
  const id = (data as { id: string } | null)?.id;
  if (id) await recordOnboardingEvent(role, id, event);
}

// ─────────────────────────────────────────────────────────────────────
// Alumno
// ─────────────────────────────────────────────────────────────────────

const STUDENT_TOUR: Record<Lang, TourStep[]> = {
  es: [
    { anchor: "next-class",    title: "Tu próxima clase",      body: "Aquí ves tu próxima clase. 15 minutos antes aparece aquí mismo el botón «Entrar al aula»; no necesitas ningún enlace." },
    { anchor: "nav-cursos",    title: "Cursos",                body: "Tu curso completo de A1 a C1: lecciones, vídeos y ejercicios de cada nivel. Avanza por tu ruta entre clase y clase." },
    { anchor: "nav-clases",    title: "Mis clases",            body: "Todas tus clases, pasadas y futuras, y tu saldo." },
    { anchor: "nav-chats",     title: "Chats",                 body: "Tu profesor te escribe aquí para horarios y dudas, y aquí también hablas conmigo (Gelfis). Es nuestro único canal: revísalo cada día." },
    { anchor: "tools",         title: "SCHULE y HANS",         body: "SCHULE son tus ejercicios: el 85 % completado mantiene activa tu Garantía de Nivel. HANS es tu tutor de IA para practicar conversación 24/7." },
    { anchor: "nav-apuntes",   title: "Apuntes",               body: "El documento donde tu profesor escribe durante la clase. Siempre es el mismo; aquí queda todo lo que avanzáis." },
    { anchor: "asistente",     title: "Asistente Virtual",     body: "Pregúntale cualquier duda sobre la plataforma, tus clases o tu plan, a cualquier hora. Si no puede resolverlo, me lo pasa a mí." },
  ],
  de: [
    { anchor: "next-class",    title: "Deine nächste Stunde",  body: "Hier siehst du deine nächste Stunde. 15 Minuten vorher erscheint genau hier der Button «Zum Klassenraum»; du brauchst keinen Link." },
    { anchor: "nav-cursos",    title: "Kurse",                 body: "Dein kompletter Kurs von A1 bis C1: Lektionen, Videos und Übungen für jedes Niveau. Arbeite zwischen den Stunden deinen Weg weiter." },
    { anchor: "nav-clases",    title: "Meine Stunden",         body: "Alle deine Stunden, vergangene und kommende, und dein Guthaben." },
    { anchor: "nav-chats",     title: "Chats",                 body: "Hier schreibt dir dein Lehrer wegen Terminen und Fragen, und hier erreichst du auch mich (Gelfis). Es ist unser einziger Kanal: schau jeden Tag rein." },
    { anchor: "tools",         title: "SCHULE und HANS",       body: "SCHULE sind deine Übungen: 85 % erledigt hält deine Niveau-Garantie aktiv. HANS ist dein KI-Tutor zum Sprechen üben, rund um die Uhr." },
    { anchor: "nav-apuntes",   title: "Notizen",               body: "Das Dokument, in dem dein Lehrer während der Stunde schreibt. Es ist immer dasselbe; hier bleibt alles, was ihr erarbeitet." },
    { anchor: "asistente",     title: "Virtueller Assistent",  body: "Frag ihn jederzeit alles zur Plattform, deinen Stunden oder deinem Plan. Wenn er nicht weiterweiß, gibt er es an mich weiter." },
  ],
};

const STUDENT_CHECKLIST: Record<Lang, Array<Omit<ChecklistItem, "done">>> = {
  es: [
    { key: "chat",      label: "Responde a tu profesor en el chat",              hint: "Así acordáis horarios y resolvéis dudas.",         href: "/estudiante/chats" },
    { key: "cursos",    label: "Abre tu curso y empieza la primera lección",     hint: "Menú Cursos, nivel actual.",                        href: "/estudiante/cursos" },
    { key: "schule",    label: "Entra en SCHULE y haz tu primer bloque",         hint: "Cuenta para tu Garantía de Nivel.",                 href: "/api/entitlements/schule-open" },
    { key: "hans",      label: "Prueba HANS 5 minutos",                          hint: "Tu tutor de conversación con IA.",                   href: "/api/student/onboarding/go?step=hans" },
    { key: "asistente", label: "Pregúntale algo al Asistente Virtual",           hint: "El botón ✨ abajo a la derecha.",                   href: null },
    { key: "clase",     label: "Entra al aula de tu primera clase",              hint: "El botón aparece aquí 15 min antes de la clase.",   href: "/estudiante/clases" },
  ],
  de: [
    { key: "chat",      label: "Antworte deinem Lehrer im Chat",                 hint: "So klärt ihr Termine und Fragen.",                   href: "/estudiante/chats" },
    { key: "cursos",    label: "Öffne deinen Kurs und starte die erste Lektion", hint: "Menü Kurse, dein aktuelles Niveau.",                 href: "/estudiante/cursos" },
    { key: "schule",    label: "Öffne SCHULE und mach deinen ersten Block",      hint: "Zählt für deine Niveau-Garantie.",                   href: "/api/entitlements/schule-open" },
    { key: "hans",      label: "Probiere HANS 5 Minuten aus",                    hint: "Dein KI-Tutor zum Sprechen.",                        href: "/api/student/onboarding/go?step=hans" },
    { key: "asistente", label: "Stell dem virtuellen Assistenten eine Frage",    hint: "Der ✨-Button unten rechts.",                        href: null },
    { key: "clase",     label: "Betritt den Klassenraum deiner ersten Stunde",   hint: "Der Button erscheint hier 15 Min. vor der Stunde.",  href: "/estudiante/clases" },
  ],
};

export async function getStudentOnboarding(studentId: string, userId: string, lang: Lang, forceTour = false): Promise<OnboardingState> {
  const sb = supabaseAdmin();
  const { data: st } = await sb.from("students").select("onboarding, converted_at, created_at, schule_completion_pct").eq("id", studentId).maybeSingle();
  const s = st as { onboarding: Events | null; converted_at: string | null; created_at: string; schule_completion_pct: number | null } | null;
  const ev = (s?.onboarding ?? {}) as Events;
  const since = s?.converted_at ?? s?.created_at ?? new Date().toISOString();
  const isNew = since >= NEW_SINCE;
  const ageDays = (Date.now() - new Date(since).getTime()) / 86400_000;

  // Señales calculadas
  const [{ count: attended }, { data: myChats }] = await Promise.all([
    sb.from("class_participants").select("class_id, classes!inner(status, is_trial)", { count: "exact", head: true })
      .eq("student_id", studentId).eq("attended", true).eq("classes.status", "completed").eq("classes.is_trial", false),
    sb.from("chat_participants").select("chat_id").eq("user_id", userId),
  ]);
  let chatReplied = false;
  const chatIds = ((myChats ?? []) as Array<{ chat_id: string }>).map(c => c.chat_id);
  if (chatIds.length > 0) {
    const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).in("chat_id", chatIds).eq("author_id", userId).eq("deleted", false);
    chatReplied = (count ?? 0) > 0;
  }

  const done: Record<string, boolean> = {
    chat:      chatReplied,
    cursos:    !!ev.cursos,
    schule:    !!ev.schule || (s?.schule_completion_pct ?? 0) > 0,
    hans:      !!ev.hans,
    asistente: !!ev.asistente,
    clase:     (attended ?? 0) > 0,
  };
  const checklist = STUDENT_CHECKLIST[lang].map(i => ({ ...i, done: done[i.key] ?? false }));
  const allDone = checklist.every(i => i.done);

  const showTour = forceTour || (!ev.tour_seen && !ev.tour_dismissed && (isNew || (attended ?? 0) < 3));
  const showChecklist = isNew && !ev.checklist_dismissed && !allDone && ageDays <= CHECKLIST_DAYS;
  return { showTour, showChecklist, checklist, tourSteps: STUDENT_TOUR[lang], lang };
}
