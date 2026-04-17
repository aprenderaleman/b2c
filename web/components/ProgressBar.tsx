"use client";

import { motion } from "framer-motion";

export function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (step / total) * 100));
  return (
    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
      <motion.div
        className="h-full bg-brand-500 rounded-full"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
    </div>
  );
}
