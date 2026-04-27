"use client";

import { useState } from "react";
import { ClassEditModal } from "@/components/admin/ClassEditModal";

/**
 * Thin client wrapper so the admin class-detail page (server component)
 * can open the edit modal without becoming client-rendered itself.
 */
export function EditClassButton(props: {
  classId:         string;
  title:           string;
  topic:           string | null;
  scheduledAt:     string;
  durationMinutes: number;
  seriesSize:      number;          // 1 = one-off; >1 = part of a series
  teacherId:       string;
  groupId:         string | null;
  groupName:       string | null;
  participantIds:  string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600"
      >
        Editar
      </button>
      <ClassEditModal
        open={open}
        onClose={() => setOpen(false)}
        classInfo={{
          id:              props.classId,
          title:           props.title,
          topic:           props.topic,
          scheduledAt:     props.scheduledAt,
          durationMinutes: props.durationMinutes,
          seriesSize:      props.seriesSize,
          teacherId:       props.teacherId,
          groupId:         props.groupId,
          groupName:       props.groupName,
          participantIds:  props.participantIds,
        }}
      />
    </>
  );
}
