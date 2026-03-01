/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0f1117",
          card: "#181a24",
          "card-hover": "#1e2130",
          input: "#12131c",
        },
        border: {
          DEFAULT: "#2a2d3e",
          focus: "#4a6cf7",
        },
        text: {
          DEFAULT: "#e8eaf0",
          dim: "#8b8fa3",
          muted: "#5c5f73",
        },
        accent: {
          DEFAULT: "#4a6cf7",
          glow: "rgba(74,108,247,0.15)",
        },
        green: {
          DEFAULT: "#34d399",
          dim: "rgba(52,211,153,0.12)",
        },
        red: {
          DEFAULT: "#f87171",
          dim: "rgba(248,113,113,0.12)",
        },
        amber: {
          DEFAULT: "#fbbf24",
          dim: "rgba(251,191,36,0.12)",
        },
        cyan: "#22d3ee",
        purple: {
          DEFAULT: "#a78bfa",
          dim: "rgba(167,139,250,0.12)",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
