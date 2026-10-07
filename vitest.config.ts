import { defineConfig } from 'vitest/config';

// 자비스뷰 speechText 등 순수 함수 유닛 테스트용 최소 설정 (jsdom 불필요, node 환경 사용).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/client/**/*.test.ts'],
  },
});
