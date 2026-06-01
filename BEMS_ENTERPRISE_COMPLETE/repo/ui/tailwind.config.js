/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bems: {
          ink: "#0f172a",
          panel: "#ffffff",
          line: "#dbe4ef",
          brand: "#2563eb",
          success: "#16a34a",
          warning: "#f59e0b",
          danger: "#dc2626",
        },
      },
      boxShadow: {
        operator: "0 10px 30px rgba(15, 23, 42, 0.08)",
        "operator-dark": "0 18px 40px rgba(0, 0, 0, 0.32)",
      },
    },
  },
  plugins: [],
};
