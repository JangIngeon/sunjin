import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Serve under a relative base so the built dashboard can be hosted
  // next to the existing static glossary pages.
  base: './',
})
