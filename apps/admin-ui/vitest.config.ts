import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['src/setup-tests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Bumped from 10s (2026-10-29): with 9+ test files, spinning up that many
    // jsdom environments concurrently can itself eat several seconds under
    // load, which was flakily tripping the old timeout — not a test bug.
    testTimeout: 20_000,
  },
});
