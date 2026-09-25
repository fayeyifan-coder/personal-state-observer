import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '私人观察台',
        short_name: '观察台',
        description: '个人状态观察器，本地优先。',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5f2ea',
        theme_color: '#f5f2ea',
        lang: 'zh-CN',
        icons: []
      }
    })
  ]
})