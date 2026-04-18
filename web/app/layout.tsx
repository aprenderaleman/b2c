import type { Metadata } from "next";
import { LangProvider } from "@/lib/lang-context";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aprender-Aleman.de — Aprender alemán online",
  description:
    "Academia online de alemán para hispanohablantes. Profesores nativos certificados + preparación Goethe/TELC + Hans, tu profesor IA 24/7.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFBF5" },
    { media: "(prefers-color-scheme: dark)",  color: "#0A0A0F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Avoid flash of light content on dark-preference users. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <LangProvider>{children}</LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
