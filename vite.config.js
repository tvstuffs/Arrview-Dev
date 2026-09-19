import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.js',
    registerType: 'autoUpdate',
    injectRegister: false,
    manifest: {
      id: '/', name: 'ArrView', short_name: 'ArrView',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#0d1117', theme_color: '#0d1117',
      icons: [
        { src: '/arrview-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/arrview-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/arrview-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,png,svg,html,webmanifest}'],
      // Navigations use the network first, never a precache-first HTML shell.
      globIgnores: ['index.html'],
    },
  })],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7777',
        changeOrigin: true
      }
    }
  }
})
