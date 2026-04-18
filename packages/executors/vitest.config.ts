import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['builtin/**/*.test.ts'],
  },
});
