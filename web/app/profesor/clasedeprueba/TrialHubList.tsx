"use client";

import { useState } from "react";
import type { TrialClassRow } from "@/lib/trial-classes";
import { TrialHubCard } from "./TrialHubCard";

export function TrialHubList({
  rows,
  studentMap,
  isAdmin = false,
  canDelete = false,
}: {
  rows: TrialClassRow[];
  studentMap: Record<string, string>;
  isAdmin?: boolean;
  canDelete?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {rows.map((r) => (
        <TrialHubCard
          key={r.classId}
          row={r}
          expanded={expandedId === r.classId}
          onToggle={() => setExpandedId(expandedId === r.classId ? null : r.classId)}
          studentId={r.leadConvertedToUserId ? (studentMap[r.leadConvertedToUserId] ?? null) : null}
          isAdmin={isAdmin}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
