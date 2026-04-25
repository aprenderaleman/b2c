import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { LangProvider } from "@/lib/lang-context";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme-context";
import "./globals.css";

// Single typeface across the whole app. `display: swap` so the page
// renders immediately with the system fallback while Inter loads,
// avoiding the FOIT/FOUT flicker. The variable is consumed in
// tailwind.config.ts where fontFamily.sans is wired to it.
const inter = Inter({
  subsets:  ["latin"],
  variable: "--font-inter",
  display:  "swap",
});

// Google Ads tag (tracks conversions from paid campaigns across every page).
// Lives at the root layout so it's injected exactly once per navigation.
const GOOGLE_ADS_ID = "AW-17724667323";

export const metadata: Metadata = {
  title: "Aprender-Aleman.de — Aprender alemán online",
  description:
    "Academia online de alemán para hispanohablantes. Profesores nativos certificados + preparación Goethe/TELC + Hans, tu profesor IA 24/7.",
};

export const viewport = {
  // Mobile browsers paint the chrome with these. Match the new
  // background tokens so the system UI blends instead of clashing.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F9FB" },
    { media: "(prefers-color-scheme: dark)",  color: "#0E1B2E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
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
