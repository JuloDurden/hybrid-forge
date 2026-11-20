import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Servi par GitHub Pages sous https://julodurden.github.io/hybrid-forge/
export default defineConfig({
  base: '/hybrid-forge/',
  plugins: [react()],
})
