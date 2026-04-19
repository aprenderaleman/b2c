"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Shortcut that starts an impersonation session for a specific user. Goes
 * on admin detail pages (/admin/estudiantes/[id], /admin/profesores/[id])
 * as a one-click alternative to the global picker in the sidebar.
 *
 * Note: `userId` is the users.id (NOT students.id / teachers.id) — the
 * server needs the canonical user row to sign the cookie.
 */
export function ImpersonateButton({
  userId, userName, role,
}: {
  userId:   string;
  userName: string;
  role:     "teacher" | "student";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const res  = await fetch("/api/admin/impersonate/start", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ target_user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`No se pudo: ${data?.error ?? "error"}`); return; }
    router.push(data.redirect ?? "/");
    router.refresh();
  });

  const label = role === "teacher" ? `Ver como ${userName.split(" ")[0]} (profesor)`
                                   : `Ver como ${userName.split(" ")[0]}`;
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      title="Entra a su cuenta como si fueras él/ella (sesión simulada, 2h)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {pending ? "Entrando…" : label}
    </button>
  );
}
