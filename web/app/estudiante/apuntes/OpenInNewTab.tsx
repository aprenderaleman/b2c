"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function OpenInNewTab({ url }: { url: string }) {
  const router = useRouter();

  useEffect(() => {
    window.open(url, "_blank", "noopener");
    router.back();
  }, [url, router]);

  return (
    <main className="flex items-center justify-center min-h-[40vh]">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Abriendo apuntes en una nueva pestaña…
      </p>
    </main>
  );
}
