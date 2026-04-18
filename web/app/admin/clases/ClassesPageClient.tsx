"use client";

import { useState } from "react";
import { CreateClassModal } from "@/components/admin/CreateClassModal";

/**
 * Tiny client-side island for the server-rendered /admin/clases page:
 * the "+ Agendar clase" button + its modal. Keeping this isolated from
 * the table lets the list stay fully SSR.
 */
export function ClassesPageClient() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        + Agendar clase
      </button>
      <CreateClassModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
