/**
 * Small button that opens the group's Google Doc in a new tab. Silent
 * if the group doesn't have a document_url yet (so we don't leave an
 * empty placeholder in the UI).
 *
 * Same component used on /profesor/clases/[id] and /estudiante/clases/[id].
 */
export function GroupDocButton({
  documentUrl,
  label = "Apuntes del grupo",
}: {
  documentUrl: string | null;
  label?: string;
}) {
  if (!documentUrl) return null;
  return (
    <a
      href={documentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-400 text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 px-3.5 py-2 text-sm font-medium transition-colors"
      title="Abre el documento compartido del grupo en Google Docs"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h8M8 9h2" />
      </svg>
      {label}
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 17L17 7M17 7H9M17 7v8" />
      </svg>
    </a>
  );
}
