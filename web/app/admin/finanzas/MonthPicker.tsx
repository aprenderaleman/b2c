"use client";

import { useRouter } from "next/navigation";

export function FinanceMonthPicker({ currentMonth }: { currentMonth: string }) {
  const router = useRouter();
  return (
    <input
      type="month"
      value={currentMonth}
      onChange={(e) => router.push(`/admin/finanzas?month=${e.target.value}`)}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
    />
  );
}
