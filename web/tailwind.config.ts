import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#FFF7ED",
          100: "#FFEDD5",
          200: "#FED7AA",
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
          800: "#9A3412",
          900: "#7C2D12",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        brand:       "0 8px 24px -8px rgba(249, 115, 22, 0.45)",
        "brand-lg":  "0 20px 50px -15px rgba(249, 115, 22, 0.55)",
        "glow":      "0 0 30px -5px rgba(251, 146, 60, 0.4)",
      },
      backgroundImage: {
        "radial-fade": "radial-gradient(ellipse at top, rgba(249,115,22,0.18), transparent 60%)",
        "radial-fade-dark": "radial-gradient(ellipse at top, rgba(251,146,60,0.22), transparent 60%)",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%":     { transform: "translateY(-8px)" },
        },
        pulseGlow: {
          "0%,100%": { boxShadow: "0 8px 24px -8px rgba(249,115,22,0.45)" },
          "50%":     { boxShadow: "0 12px 40px -8px rgba(249,115,22,0.75)" },
        },
        // Slow drifts for the hero mesh-gradient blobs. Three phases with
        // distinct paths so the layered colours never line up the same
        // way twice in a single cycle — gives the "aurora" feel.
        auroraA: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%":     { transform: "translate3d(60px,40px,0) scale(1.08)" },
        },
        auroraB: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%":     { transform: "translate3d(-50px,30px,0) scale(0.95)" },
          "66%":     { transform: "translate3d(40px,-30px,0) scale(1.05)" },
        },
        auroraC: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%":     { transform: "translate3d(-40px,-50px,0) scale(1.1)" },
        },
      },
      animation: {
        "fade-in":    "fadeIn 0.4s ease-out",
        "float":      "float 6s ease-in-out infinite",
        "pulse-glow": "pulseGlow 2.5s ease-in-out infinite",
        "aurora-a":   "auroraA 18s ease-in-out infinite",
        "aurora-b":   "auroraB 22s ease-in-out infinite",
        "aurora-c":   "auroraC 26s ease-in-out infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
