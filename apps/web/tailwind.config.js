/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1419",
        paper: "#f4f6f8",
        accent: "#1f6feb",
        mist: "#d8e1ec",
      },
      fontFamily: {
        display: ["\"IBM Plex Sans\"", "system-ui", "sans-serif"],
        body: ["\"Source Sans 3\"", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
