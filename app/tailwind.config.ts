import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v("brand"), hover: v("brand-hover"), soft: v("brand-soft"), bright: v("brand-bright") },
        bg: v("bg"),
        surface: { DEFAULT: v("surface"), 2: v("surface-2") },
        line: v("line"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        night: { DEFAULT: v("night"), 2: v("night-2"), line: v("night-line") },
        ok: { DEFAULT: v("ok"), soft: v("ok-soft") },
        bad: { DEFAULT: v("bad"), soft: v("bad-soft") },
        warn: { DEFAULT: v("warn"), soft: v("warn-soft") },
      },
      borderRadius: { DEFAULT: "var(--radius)", sm: "var(--radius-sm)", lg: "var(--radius)" },
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"] },
      boxShadow: { card: "var(--shadow-card)" },
      maxWidth: { page: "1200px" },
    },
  },
  plugins: [],
} satisfies Config;
