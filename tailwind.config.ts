import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {
    colors: {
      porcelain: "#F7F8FA", frost: "#E9EDF2", crystal: "#FFFFFF", graphite: "#18212F", muted: "#5B6472", faint: "#8A93A1",
      cobalt: { DEFAULT: "#5878D8", ink: "#3D5BBF", wash: "rgba(88,120,216,.10)" },
      sea: { DEFAULT: "#A6D8D4", ink: "#2F7F78" }, silver: "#C7D1DD", champagne: "#E7D9BD", brass: "#B8954F", ember: "#C8664A",
      ok: "#2F7F5F", err: "#B4442F",
      // legacy aliases used by older pages
      ink: "#18212F", forest: "#3D5BBF", mint: "#A6D8D4", paper: "#F7F8FA",
    },
    boxShadow: { soft: "0 1px 2px rgba(24,33,47,.05), 0 12px 30px -14px rgba(24,33,47,.22)", glow: "0 2px 6px rgba(24,33,47,.06), 0 32px 60px -28px rgba(24,33,47,.32)" },
  } },
  plugins: [],
};
export default config;
