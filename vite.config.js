import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/fishing-assistant/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fishing Assistant',
        short_name: 'Fishing',
        description: 'Asisten arah lempar dan kondisi laut',
        theme_color: '#0b1320',
        background_color: '#0b1320',
        display: 'standalone',
        start_url: '/fishing-assistant/',
          scope: '/fishing-assistant/',
        icons: []
      }
    })
  ],
  server: {
    proxy: {
      '/api/marine': {
        target: 'https://marine-api.open-meteo.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/marine/, '/v1/marine')
      },
      '/api/gebco': {
        target: 'https://api.opentopodata.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/gebco/, '/v1/gebco2020')
      }
    }
  }
})
