"use client";

import { useState } from "react";
import { CreateClassModal } from "@/components/admin/CreateClassModal";

/**
 * "+ Nueva clase" action shown in the teacher's class list header.
 * Opens the shared CreateClassModal in "teacher" mode (own students
 * only, teacherId forced server-side to the caller).
 */
export function NewClassButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Nueva clase
      </button>
      <CreateClassModal open={open} onClose={() => setOpen(false)} mode="teacher" />
    </>
  );
}
