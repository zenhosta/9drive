import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg', 'maskable-icon.svg'],
      manifest: {
        name: '9Drive',
        short_name: '9Drive',
        description: 'Google Drive storage gateway for files, folders, sharing, and quota tracking.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/all-files',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
          { src: '/pwa-192x192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/pwa-512x512.svg', sizes: '512x512', type: 'image/svg+xml' },
          { src: '/maskable-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/(auth|connected-accounts|files|folders|invites|jobs|drive-index|provider-configs|public|storage|uploads)(\/|$)/],
        globPatterns: ['**/*.{js,css,html,svg,ico,png,webp,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
