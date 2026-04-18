"use client";

export function DeleteLeadButton({ leadId }: { leadId: string }) {
  return (
    <form
      action={`/api/admin/leads/${leadId}/delete`}
      method="post"
      onSubmit={(e) => {
        if (!confirm(
          "Esto BORRARÁ PERMANENTEMENTE al lead, su historial y todas las notas. " +
          "Exporta los datos primero si podrías necesitarlos. ¿Continuar?"
        )) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="text-xs font-medium rounded-full
                   border border-red-200 dark:border-red-500/30
                   bg-red-50 dark:bg-red-500/10
                   px-3 py-1
                   text-red-700 dark:text-red-300
                   hover:bg-red-100 dark:hover:bg-red-500/20"
        title="RGPD: derecho de supresión"
      >
        Eliminar (RGPD)
      </button>
    </form>
  );
}
