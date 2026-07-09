"use client";

import { useState } from "react";
import { ScheduleClassModal } from "@/app/profesor/clasedeprueba/ScheduleClassModal";

export function ScheduleButton({ studentId, studentName }: {
  studentId: string;
  studentName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2
                   rounded-2xl border border-sky-300 dark:border-sky-500/40
                   bg-sky-50 dark:bg-sky-500/10
                   hover:bg-sky-100 dark:hover:bg-sky-500/20
                   text-sky-800 dark:text-sky-200 text-sm font-semibold
                   px-4 py-3 transition-colors"
      >
        📅 Programar clases
      </button>

      {open && (
        <ScheduleClassModal
          studentId={studentId}
          studentName={studentName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
