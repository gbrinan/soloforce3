import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 노트 임베딩 워커는 ESM 워커로 번들. 대형 ML 라이브러리는 사전 번들 제외(워커 호환·빌드 속도).
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'] },
  root: resolve(__dirname),
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3456',
      '/attachments': 'http://localhost:3456',
    },
  },
});
