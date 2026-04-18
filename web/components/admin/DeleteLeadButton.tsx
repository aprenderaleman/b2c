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
        className="text-xs font-medium rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700 hover:bg-red-100"
        title="RGPD: derecho de supresión"
      >
        Eliminar (RGPD)
      </button>
    </form>
  );
}
