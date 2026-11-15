import type { Config } from "tailwindcss";

// Los colores se leen de tokens CSS (src/index.css) en formato "R G B"
// para que funcionen los modificadores de opacidad de Tailwind (bg-accent/10).
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: { 1: token("surface-1"), 2: token("surface-2"), 3: token("surface-3") },
        line: token("line"),
        fg: { DEFAULT: token("fg"), muted: token("fg-muted"), subtle: token("fg-subtle") },
        accent: { DEFAULT: token("accent"), strong: token("accent-strong"), fg: token("accent-fg") },
        prio: { critica: token("prio-critica"), alta: token("prio-alta"), media: token("prio-media"), baja: token("prio-baja") },
        health: { normal: token("health-normal"), caida: token("health-caida"), saturada: token("health-saturada"), inhabilitada: token("health-inhabilitada") },
        ok: token("ok"),
        danger: token("danger"),
        warn: token("warn"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      // Escala tipográfica (px / line-height)
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }], // 11
        xs: ["0.75rem", { lineHeight: "1rem" }], // 12
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13
        base: ["0.875rem", { lineHeight: "1.375rem" }], // 14
        md: ["1rem", { lineHeight: "1.5rem" }], // 16
        lg: ["1.125rem", { lineHeight: "1.625rem" }], // 18
        xl: ["1.375rem", { lineHeight: "1.75rem" }], // 22
        "2xl": ["1.75rem", { lineHeight: "2.125rem" }], // 28
        "3xl": ["2.25rem", { lineHeight: "2.5rem" }], // 36
      },
      // Pasos de opacidad extra usados por bordes translúcidos y fondos tintados
      opacity: { 6: "0.06", 8: "0.08", 12: "0.12", 14: "0.14", 16: "0.16", 18: "0.18", 35: "0.35", 45: "0.45", 85: "0.85" },
      borderRadius: { sm: "4px", DEFAULT: "6px", md: "8px", lg: "12px", xl: "16px" },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.4), 0 0 24px -4px rgb(var(--accent) / 0.35)",
      },
      transitionDuration: { DEFAULT: "180ms" },
      keyframes: {
        "live-pulse": { "0%": { boxShadow: "0 0 0 0 rgb(var(--ok) / 0.6)" }, "70%": { boxShadow: "0 0 0 7px rgb(var(--ok) / 0)" }, "100%": { boxShadow: "0 0 0 0 rgb(var(--ok) / 0)" } },
        "row-flash": { "0%": { backgroundColor: "rgb(var(--accent) / 0.28)" }, "100%": { backgroundColor: "transparent" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        "slide-up": { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        "page-in": { from: { transform: "translateY(6px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        "pop-in": { "0%": { transform: "scale(0.6)", opacity: "0" }, "60%": { transform: "scale(1.08)", opacity: "1" }, "100%": { transform: "scale(1)" } },
        "scale-in": { from: { transform: "scale(0.97)", opacity: "0" }, to: { transform: "scale(1)", opacity: "1" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "live-pulse": "live-pulse 1.8s ease-out infinite",
        "row-flash": "row-flash 2.4s ease-out 1",
        "fade-in": "fade-in 180ms ease-out",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-up": "slide-up 200ms ease-out",
        "scale-in": "scale-in 160ms ease-out",
        "page-in": "page-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "pop-in": "pop-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
