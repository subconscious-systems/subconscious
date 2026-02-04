/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Cabinet Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        midnight: "#0a0a0f",
        dusk: "#12121a",
        slate: "#1a1a24",
        mist: "#8b8b9e",
        ember: "#ff6b4a",
        coral: "#ff8066",
        sage: "#4ade80",
      },
    },
  },
  plugins: [],
};
