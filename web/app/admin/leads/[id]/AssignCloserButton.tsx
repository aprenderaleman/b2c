"use client";

import { useState } from "react";
import { AssignCloserModal } from "@/components/admin/AssignCloserModal";

export function AssignCloserButton({
  leadId,
  currentCloserId,
}: {
  leadId: string;
  currentCloserId: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold rounded-full border border-sky-300 dark:border-sky-500/40 bg-sky-100 dark:bg-sky-500/15 px-3 py-1.5 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-500/25"
      >
        {currentCloserId ? "🔄 Reasignar closer" : "👤 Asignar closer"}
      </button>
      {open && <AssignCloserModal leadId={leadId} onClose={() => setOpen(false)} />}
    </>
  );
}
