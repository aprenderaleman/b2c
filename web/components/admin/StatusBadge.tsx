const MAP: Record<string, { label: string; cls: string }> = {
  new:                 { label: "New",                cls: "bg-orange-50  text-orange-700 border-orange-200" },
  contacted_1:         { label: "Contact 1",          cls: "bg-slate-50   text-slate-600  border-slate-200"  },
  contacted_2:         { label: "Contact 2",          cls: "bg-slate-50   text-slate-600  border-slate-200"  },
  contacted_3:         { label: "Contact 3",          cls: "bg-slate-50   text-slate-600  border-slate-200"  },
  contacted_4:         { label: "Contact 4",          cls: "bg-slate-50   text-slate-600  border-slate-200"  },
  contacted_5:         { label: "Contact 5",          cls: "bg-slate-50   text-slate-600  border-slate-200"  },
  in_conversation:     { label: "In conversation",    cls: "bg-blue-50    text-blue-700   border-blue-200"   },
  link_sent:           { label: "Link sent",          cls: "bg-cyan-50    text-cyan-700   border-cyan-200"   },
  trial_scheduled:     { label: "Trial scheduled",    cls: "bg-violet-50  text-violet-700 border-violet-200" },
  trial_reminded:      { label: "Reminded",           cls: "bg-violet-50  text-violet-700 border-violet-200" },
  trial_absent:        { label: "No-show",            cls: "bg-amber-50   text-amber-700  border-amber-200"  },
  absent_followup_1:   { label: "Re-engage 1",        cls: "bg-amber-50   text-amber-700  border-amber-200"  },
  absent_followup_2:   { label: "Re-engage 2",        cls: "bg-amber-50   text-amber-700  border-amber-200"  },
  absent_followup_3:   { label: "Re-engage 3",        cls: "bg-amber-50   text-amber-700  border-amber-200"  },
  needs_human:         { label: "Needs human",        cls: "bg-red-50     text-red-700    border-red-200"    },
  converted:           { label: "Converted",          cls: "bg-emerald-50 text-emerald-700 border-emerald-200"},
  cold:                { label: "Cold",               cls: "bg-slate-100  text-slate-500  border-slate-200"  },
  lost:                { label: "Lost",               cls: "bg-slate-100  text-slate-500  border-slate-300"  },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
