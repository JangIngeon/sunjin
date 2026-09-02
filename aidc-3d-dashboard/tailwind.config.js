/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Strict flow-color rules shared with the 3D scene (src/constants.js)
        power: '#F3C623', // Yellow  – electrical power
        fws: '#3B82F6',   // Blue    – Facility Water Supply (cold)
        fwr: '#F97316',   // Orange  – Facility Water Return (hot)
        tcs: '#14B8A6',   // Teal    – Technology Cooling System (liquid cooling)
      },
      fontFamily: {
        sans: ['Pretendard', 'Apple SD Gothic Neo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
