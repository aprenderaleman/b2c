import type { Metadata } from "next";
import Script from "next/script";
import { LangProvider } from "@/lib/lang-context";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme-context";
import "./globals.css";

// Google Ads tag (tracks conversions from paid campaigns across every page).
// Lives at the root layout so it's injected exactly once per navigation.
const GOOGLE_ADS_ID = "AW-17724667323";

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

        {/* Google tag (gtag.js) — Google Ads conversion tracking.
            Using next/script with afterInteractive so it doesn't block
            first paint but still initialises before any user action
            we'd want to measure. */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-ads-gtag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GOOGLE_ADS_ID}');
          `}
        </Script>
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <LangProvider>{children}</LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
