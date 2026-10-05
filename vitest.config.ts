import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['apps/api/src/**/*.ts', 'apps/web/src/lib/**/*.ts'] },
  },
});
