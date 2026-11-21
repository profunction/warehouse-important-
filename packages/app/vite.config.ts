import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate', includeAssets: ['icon.svg'],
    manifest: { name: '仓店通 WarehouseShop', short_name: '仓店通', lang: 'zh', start_url: '/', display: 'standalone', orientation: 'portrait', background_color: '#FAFAFA', theme_color: '#1B8A3A', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] },
    workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//], runtimeCaching: [{ urlPattern: /^\/api\/v1\/files\//, handler: 'NetworkOnly' }] },
  })],
  // strictPort：5173 被占就报错而不是悄悄换 5174（隧道指向 5173）；allowedHosts：放行 Cloudflare 临时隧道网址
  server: { strictPort: true, allowedHosts: ['.trycloudflare.com', 'localhost'], proxy: { '/api': { target: process.env.API_URL || 'http://localhost:3000', changeOrigin: true } } },
  build: { sourcemap: false },
});
