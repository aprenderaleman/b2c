const MAP: Record<string, { label: string; cls: string }> = {
  new:                 { label: "Nuevo",                cls: "bg-orange-50  dark:bg-orange-500/10  text-orange-700  dark:text-orange-300  border-orange-200  dark:border-orange-500/30" },
  contacted_1:         { label: "Contacto 1",           cls: "bg-slate-50   dark:bg-slate-800      text-slate-600   dark:text-slate-300   border-slate-200   dark:border-slate-700"      },
  contacted_2:         { label: "Contacto 2",           cls: "bg-slate-50   dark:bg-slate-800      text-slate-600   dark:text-slate-300   border-slate-200   dark:border-slate-700"      },
  contacted_3:         { label: "Contacto 3",           cls: "bg-slate-50   dark:bg-slate-800      text-slate-600   dark:text-slate-300   border-slate-200   dark:border-slate-700"      },
  contacted_4:         { label: "Contacto 4",           cls: "bg-slate-50   dark:bg-slate-800      text-slate-600   dark:text-slate-300   border-slate-200   dark:border-slate-700"      },
  contacted_5:         { label: "Contacto 5",           cls: "bg-slate-50   dark:bg-slate-800      text-slate-600   dark:text-slate-300   border-slate-200   dark:border-slate-700"      },
  in_conversation:     { label: "En conversación",      cls: "bg-blue-50    dark:bg-blue-500/10    text-blue-700    dark:text-blue-300    border-blue-200    dark:border-blue-500/30"    },
  link_sent:           { label: "Enlace enviado",       cls: "bg-cyan-50    dark:bg-cyan-500/10    text-cyan-700    dark:text-cyan-300    border-cyan-200    dark:border-cyan-500/30"    },
  trial_scheduled:     { label: "Clase agendada",       cls: "bg-violet-50  dark:bg-violet-500/10  text-violet-700  dark:text-violet-300  border-violet-200  dark:border-violet-500/30"  },
  trial_reminded:      { label: "Recordatorio enviado", cls: "bg-violet-50  dark:bg-violet-500/10  text-violet-700  dark:text-violet-300  border-violet-200  dark:border-violet-500/30"  },
  trial_absent:        { label: "No asistió",           cls: "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   },
  absent_followup_1:   { label: "Reenganche 1",         cls: "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   },
  absent_followup_2:   { label: "Reenganche 2",         cls: "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   },
  absent_followup_3:   { label: "Reenganche 3",         cls: "bg-amber-50   dark:bg-amber-500/10   text-amber-700   dark:text-amber-300   border-amber-200   dark:border-amber-500/30"   },
  needs_human:         { label: "Requiere humano",      cls: "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30"     },
  converted:           { label: "Convertido",           cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
  cold:                { label: "Frío",                 cls: "bg-slate-100  dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700"      },
  lost:                { label: "Perdido",              cls: "bg-slate-100  dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-300   dark:border-slate-700"      },
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? {
    label: status,
    cls: "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
