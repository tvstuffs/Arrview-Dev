import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', include: ['tests/web/**/*.test.jsx'], setupFiles: ['tests/web/setup.js'] },
})
