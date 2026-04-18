import type { Metadata } from "next";
import { LangProvider } from "@/lib/lang-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aprender-Aleman.de — Aprender alemán online",
  description:
    "Academia online de alemán para hispanohablantes. Profesores nativos + IA + resultados garantizados.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen">
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
