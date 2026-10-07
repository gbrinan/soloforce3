import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

const BASE = process.env.VITE_BASE_PATH ?? '/api/apps/diary/proxy/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    port: 13246,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', port: 13246, clientPort: 13246 },
  },
  preview: {
    host: '127.0.0.1',
    port: 13246,
    strictPort: true,
  },
});
