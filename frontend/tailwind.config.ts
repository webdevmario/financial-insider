/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Dark-mode tokens from DESIGN.md. The names are older than the tokens:
      //   bg = background-base, bg-card = background-raised, bg-overlay = background-overlay,
      //   bg-sunken = background-sunken, text = text-strong, text-dim = text-weak,
      //   text-muted = icon-neutral (white 60%), border = stroke-weak, border-strong = stroke-strong,
      //   accent = brand, text-ink = text-inverse-strong (labels on a brand fill).
      // Foregrounds are white at the token opacities, flattened over background-raised
      // so Tailwind's /opacity modifiers keep working.
      colors: {
        bg: {
          DEFAULT: "#12131A",
          card: "#1D1E26",
          "card-hover": "#2B2C33", // raised + fill-hover (white 6%)
          input: "#12131A",
          overlay: "#292B33",
          sunken: "#000000",
        },
        border: {
          DEFAULT: "#383940", // stroke-weak: white 12%
          strong: "#A5A5A8", // stroke-strong: white 60%, 3:1 for inputs
          focus: "#A3B2FF",
        },
        text: {
          DEFAULT: "#FFFFFF",
          dim: "#CDCECF", // white 78%
          muted: "#A5A5A8", // white 60%, still 5.7:1 on the overlay
          ink: "#10173C", // text-inverse-strong on the brand fill
        },
        accent: {
          DEFAULT: "#A3B2FF",
          glow: "rgb(163 178 255 / 6%)", // fill-brand-weak
        },
        green: {
          DEFAULT: "#77C7AF",
          dim: "rgb(119 199 175 / 8%)",
        },
        red: {
          DEFAULT: "#FF9C9C",
          dim: "rgb(255 156 156 / 8%)",
        },
        amber: {
          DEFAULT: "#E0BE70",
          dim: "rgb(224 190 112 / 8%)",
        },
        cyan: "#7EC0E5", // information
        purple: {
          DEFAULT: "#D2B2FF",
          dim: "rgb(210 178 255 / 8%)",
        },
      },
      fontFamily: {
        sans: ["DM Sans Variable", "DM Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
