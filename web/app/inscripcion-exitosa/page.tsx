export const metadata = { title: "Inscripcion exitosa · Aprender-Aleman.de" };

export default function InscripcionExitosaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-white dark:from-slate-900 dark:to-slate-950 px-4">
      <div className="max-w-md text-center space-y-4">
        <div className="text-5xl">🎉</div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Pago recibido
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Tu inscripcion ha sido procesada correctamente. En breve recibiras un
          email con los detalles de tu plan y los proximos pasos.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-500">
          Si tienes alguna duda, contactanos por WhatsApp.
        </p>
      </div>
    </main>
  );
}
