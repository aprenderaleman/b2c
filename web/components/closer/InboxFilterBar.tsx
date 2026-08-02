"use client";

type Filter = {
  key: string;
  label: string;
  count: number;
};

type Props = {
  filters: Filter[];
  active: string;
  onChange: (key: string) => void;
};

export function InboxFilterBar({ filters, active, onChange }: Props) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
      {filters.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            active === f.key
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          {f.label} ({f.count})
        </button>
      ))}
    </div>
  );
}
