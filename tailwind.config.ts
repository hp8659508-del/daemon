import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {
    colors: { ink: "#070a12", forest: "#2879d8", mint: "#b9dcff", paper: "#070a12" },
    boxShadow: { soft: "0 18px 55px rgba(0, 0, 0, .32)", glow: "0 0 35px rgba(86, 160, 255, .18)" }
  } },
  plugins: []
};
export default config;
