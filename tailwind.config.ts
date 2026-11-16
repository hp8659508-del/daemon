import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {
    colors: {
      porcelain: "#ECEEFF", frost: "#F4F3FF", crystal: "#FFFFFF", graphite: "#0E0B2B", muted: "#5E5A86", faint: "#9A96B8",
      violet: { DEFAULT: "#6B4BFF", 2: "#9D85FF", soft: "#E7E1FF", wash: "#F4F3FF", ink: "#5136E0" },
      cobalt: { DEFAULT: "#6B4BFF", ink: "#5136E0", wash: "rgba(107,75,255,.10)" },
      sea: { DEFAULT: "#9D85FF", ink: "#5136E0" }, silver: "#DFDCF7", champagne: "#E7E1FF", brass: "#6B4BFF", ember: "#D6345A",
      ok: "#14966A", err: "#D6345A",
      ink: "#0E0B2B", forest: "#5136E0", mint: "#9D85FF", paper: "#ECEEFF",
    },
    boxShadow: { soft: "0 1px 2px rgba(24,33,47,.05), 0 12px 30px -14px rgba(24,33,47,.22)", glow: "0 2px 6px rgba(24,33,47,.06), 0 32px 60px -28px rgba(24,33,47,.32)" },
  } },
  plugins: [],
};
export default config;
