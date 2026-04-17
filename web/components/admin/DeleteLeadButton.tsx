"use client";

export function DeleteLeadButton({ leadId }: { leadId: string }) {
  return (
    <form
      action={`/api/admin/leads/${leadId}/delete`}
      method="post"
      onSubmit={(e) => {
        if (!confirm(
          "This will PERMANENTLY erase the lead, their timeline and all notes. " +
          "Export the data first if you might need it. Continue?"
        )) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="text-xs font-medium rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700 hover:bg-red-100"
        title="GDPR right to erasure"
      >
        Delete (GDPR)
      </button>
    </form>
  );
}
