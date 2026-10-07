import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

const BASE = process.env.VITE_BASE_PATH ?? '/api/apps/learn/proxy/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    port: 13247,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', port: 13247, clientPort: 13247 },
  },
  preview: {
    host: '127.0.0.1',
    port: 13247,
    strictPort: true,
  },
});
