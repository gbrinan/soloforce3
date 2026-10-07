import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const BASE = process.env.VITE_BASE_PATH ?? '/api/apps/mymaps/proxy/';

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 13211,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', port: 13211, clientPort: 13211 },
  },
  preview: {
    host: '127.0.0.1',
    port: 13211,
    strictPort: true,
  },
});
