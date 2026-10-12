import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import i18n from './i18n/config';
import { server } from './api/mocks/server';
import { resetFixtures } from './api/mocks/fixtures';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  void i18n.changeLanguage('en');
});

afterEach(() => {
  // `globals: false` in vitest.config.ts means RTL's own auto-cleanup (which
  // detects a *global* afterEach) never kicks in, so each render would stack
  // up in the document instead of being unmounted between tests.
  cleanup();
  server.resetHandlers();
  resetFixtures();
  // Fix the test locale to English regardless of what a previous test (or
  // this machine's localStorage) left behind, since every existing
  // assertion is written against the English copy.
  void i18n.changeLanguage('en');
});

afterAll(() => server.close());
