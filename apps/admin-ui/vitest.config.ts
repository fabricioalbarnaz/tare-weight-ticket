import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['src/setup-tests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
  },
});
