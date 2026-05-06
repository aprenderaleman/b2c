"use client";

import { useState } from "react";
import { EditStudentModal } from "./EditStudentModal";

type Student = React.ComponentProps<typeof EditStudentModal>["student"];

export function EditStudentButton({ student }: { student: Student }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1 text-slate-700 dark:text-slate-200"
        title="Editar nombre, email, teléfono, nivel, suscripción…"
      >
        ✎ Editar datos
      </button>
      <EditStudentModal student={student} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
