import { supabaseAdmin } from "./supabase";
import { sendGroupAddedEmail, lifecycleEmailsEnabled } from "./email/send";
import { createNotification } from "./notifications";

/**
 * Add / remove helpers for class-group membership.
 *
 * Beyond touching `student_group_members`, these propagate the change
 * to ALREADY-SCHEDULED FUTURE classes of the group:
 *
 *   - addStudentToGroup    → upsert into class_participants for every
 *                            future class. Fires a one-shot summary
 *                            email + an in-app notification.
 *   - removeStudentFromGroup → delete from class_participants for every
 *                            future class. Past classes stay (audit).
 *
 * Why future-only? Past classes preserve attendance / billing history;
 * cancelled classes are already off the radar.
 *
 * Idempotent on both ends — adding twice is a no-op (unique index on
 * class_participants), removing twice is a no-op (DELETE matches 0
 * rows).
 *
 * Implementing once here so admin and teacher routes share the same
 * behaviour. Auth is the route's job.
 */

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export type GroupMembershipResult = {
  ok:                true;
  classesAffected:   number;
  notificationSent?: boolean;
} | {
  ok:                false;
  reason:            string;
};

// ─────────────────────────────────────────────────────────
// Add
// ─────────────────────────────────────────────────────────

export async function addStudentToGroup(
  groupId: string,
  studentId: string,
): Promise<GroupMembershipResult> {
  const sb = supabaseAdmin();

  // 1. Upsert membership (idempotent — composite PK).
  const { error: memberErr } = await sb
    .from("student_group_members")
    .upsert(
      { group_id: groupId, student_id: studentId },
      { onConflict: "group_id,student_id" },
    );
  if (memberErr) return { ok: false, reason: `member_upsert: ${memberErr.message}` };

  // 2. Find every future scheduled class of the group.
  const nowIso = new Date().toISOString();
  const { data: classRows, error: classErr } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, title")
    .eq("group_id", groupId)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });
  if (classErr) return { ok: false, reason: `classes_lookup: ${classErr.message}` };

  type ClassRow = { id: string; scheduled_at: string; duration_minutes: number; title: string };
  const futureClasses = (classRows ?? []) as ClassRow[];

  // 3. Upsert into class_participants for each. Use upsert with
  //    onConflict so a manual prior assignment doesn't break us.
  if (futureClasses.length > 0) {
    const rows = futureClasses.map(c => ({
      class_id:   c.id,
      student_id: studentId,
      attended:   null,
      counts_as_session: true,
    }));
    const { error: partErr } = await sb
      .from("class_participants")
      .upsert(rows, { onConflict: "class_id,student_id" });
    if (partErr) return { ok: false, reason: `participants_upsert: ${partErr.message}` };
  }

  // 4. Notify the student — one summary email + in-app notification.
  let notificationSent = false;
  try {
    const [studentRowRes, groupRowRes] = await Promise.all([
      sb.from("students")
        .select(`
          id, user_id,
          users!inner(email, full_name, language_preference, notifications_opt_out)
        `)
        .eq("id", studentId)
        .maybeSingle(),
      sb.from("student_groups")
        .select(`
          id, name,
          teacher:teachers(users(full_name, email))
        `)
        .eq("id", groupId)
        .maybeSingle(),
    ]);

    type Stu = {
      user_id: string;
      users: {
        email: string;
        full_name: string | null;
        language_preference: "es" | "de";
        notifications_opt_out?: boolean;
      } | Array<{
        email: string;
        full_name: string | null;
        language_preference: "es" | "de";
        notifications_opt_out?: boolean;
      }>;
    };
    type Grp = {
      name: string;
      teacher: { users: { full_name: string | null; email: string } |
                         Array<{ full_name: string | null; email: string }> } |
               Array<{ users: { full_name: string | null; email: string } |
                              Array<{ full_name: string | null; email: string }> }> | null;
    };
    const flat = <T,>(x: T | T[] | null | undefined): T | null =>
      !x ? null : Array.isArray(x) ? x[0] ?? null : x;

    const stu = studentRowRes.data as Stu | null;
    const grp = groupRowRes.data as Grp | null;
    const stuUser = stu ? flat(stu.users) : null;

    if (stu?.user_id && grp) {
      // In-app notification (always — it's a panel badge, not spam).
      // Reuses `class_scheduled` from the notification_type enum; the
      // title differentiates the group-added case from individual
      // class scheduling for the UI consumer.
      await createNotification({
        user_id:  stu.user_id,
        type:     "class_scheduled",
        title:    stuUser?.language_preference === "de"
                    ? `Neuer Gruppe hinzugefügt: ${grp.name}`
                    : `Te añadieron al grupo ${grp.name}`,
        body:     futureClasses.length > 0
                    ? (stuUser?.language_preference === "de"
                        ? `${futureClasses.length} kommende Stunde${futureClasses.length === 1 ? "" : "n"}`
                        : `${futureClasses.length} próxima${futureClasses.length === 1 ? "" : "s"} clase${futureClasses.length === 1 ? "" : "s"}`)
                    : (stuUser?.language_preference === "de"
                        ? "Noch keine Stunden agendiert"
                        : "Aún sin clases agendadas"),
        link:     "/estudiante/clases",
      });
      notificationSent = true;

      // Email summary — skip if disabled at the env level OR if the
      // recipient opted out.
      if (lifecycleEmailsEnabled() && stuUser?.email && !stuUser.notifications_opt_out) {
        const teacherWrap = grp.teacher ? flat(grp.teacher) : null;
        const tu = teacherWrap ? flat(teacherWrap.users) : null;
        const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";

        const lang  = stuUser.language_preference;
        const first = (stuUser.full_name ?? "").trim().split(/\s+/)[0] || stuUser.email;
        const nextClassDate = futureClasses[0]
          ? new Date(futureClasses[0].scheduled_at).toLocaleString(
              lang === "de" ? "de-DE" : "es-ES",
              {
                weekday: "long", day: "numeric", month: "long",
                hour: "2-digit", minute: "2-digit",
                timeZone: "Europe/Berlin",
              },
            ) + (lang === "de" ? " (Berlin)" : " (Berlín)")
          : undefined;

        sendGroupAddedEmail(stuUser.email, {
          recipientName: first,
          groupName:     grp.name,
          teacherName,
          upcomingCount: futureClasses.length,
          nextClassDate,
          myClassesUrl:  `${PLATFORM_URL}/estudiante/clases`,
          language:      lang,
        }).catch(e => console.error("[group-membership] email failed:", e));
      }
    }
  } catch (e) {
    // Notification is best-effort. If it fails the membership change
    // already succeeded; the student will see the new classes on next
    // panel load.
    console.error("[group-membership] notify failed:", e);
  }

  return { ok: true, classesAffected: futureClasses.length, notificationSent };
}

// ─────────────────────────────────────────────────────────
// Remove
// ─────────────────────────────────────────────────────────

export async function removeStudentFromGroup(
  groupId: string,
  studentId: string,
): Promise<GroupMembershipResult> {
  const sb = supabaseAdmin();

  // 1. Drop the membership row (idempotent — DELETE matches 0 rows
  //    silently if they were never a member).
  const { error: memberErr } = await sb
    .from("student_group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("student_id", studentId);
  if (memberErr) return { ok: false, reason: `member_delete: ${memberErr.message}` };

  // 2. Pull the future classes of the group, then delete the
  //    student's class_participants for those. Past + cancelled
  //    classes stay intact (audit / attendance history).
  const nowIso = new Date().toISOString();
  const { data: futureRows, error: classErr } = await sb
    .from("classes")
    .select("id")
    .eq("group_id", groupId)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso);
  if (classErr) return { ok: false, reason: `classes_lookup: ${classErr.message}` };
  const futureIds = ((futureRows ?? []) as Array<{ id: string }>).map(r => r.id);

  if (futureIds.length > 0) {
    const { error: partErr } = await sb
      .from("class_participants")
      .delete()
      .eq("student_id", studentId)
      .in("class_id", futureIds);
    if (partErr) return { ok: false, reason: `participants_delete: ${partErr.message}` };
  }

  return { ok: true, classesAffected: futureIds.length };
}
