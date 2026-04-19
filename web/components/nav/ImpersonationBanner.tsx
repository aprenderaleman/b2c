"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Sticky amber banner that shows on every page while an impersonation
 * cookie is active. Single "Volver a mi vista" button → calls the stop
 * endpoint, clears the cookie, bounces to /admin.
 */
export function ImpersonationBanner({
  adminName, targetName, targetRole,
}: {
  adminName:  string;
  targetName: string;
  targetRole: "teacher" | "student";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const stop = () => start(async () => {
    const res = await fetch("/api/admin/impersonate/stop", { method: "POST" });
    if (!res.ok) { alert("No se pudo terminar la vista simulada"); return; }
    router.push("/admin");
    router.refresh();
  });

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 shadow-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none" aria-hidden>👤</span>
          <span className="truncate">
            <strong>{adminName}</strong> viendo como{" "}
            <strong>{targetName}</strong>
            <span className="hidden sm:inline text-amber-900/80">
              {" "}({targetRole === "teacher" ? "profesor" : "estudiante"})
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={stop}
          disabled={pending}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 transition-colors disabled:opacity-50"
        >
          ← Volver a mi vista
        </button>
      </div>
    </div>
  );
}
