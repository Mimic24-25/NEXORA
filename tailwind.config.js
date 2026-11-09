/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.3), 0 20px 45px rgba(14,165,233,0.18)',
      },
    },
  },
  plugins: [],
}

