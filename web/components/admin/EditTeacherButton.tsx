"use client";

import { useState } from "react";
import { EditTeacherModal } from "./EditTeacherModal";

type Teacher = React.ComponentProps<typeof EditTeacherModal>["teacher"];

export function EditTeacherButton({ teacher }: { teacher: Teacher }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1 text-slate-700 dark:text-slate-200"
        title="Editar nombre, email, teléfono, tarifas, idiomas, niveles…"
      >
        ✎ Editar datos
      </button>
      <EditTeacherModal teacher={teacher} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
