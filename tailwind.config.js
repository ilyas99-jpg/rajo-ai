/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rajo: {
          primary: "#467ed3",
          secondary: "#467ed3",
          dark: "#224e91",
          light: "#e1ebf5",
          white: "#ffffff",
        },
      },
      boxShadow: {
        soft: "0 18px 45px rgba(34, 78, 145, 0.12)",
        glow: "0 0 40px rgba(59, 130, 246, 0.4), 0 0 80px rgba(37, 99, 235, 0.2)",
        "glow-sm": "0 0 20px rgba(59, 130, 246, 0.3)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Plus Jakarta Sans",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
