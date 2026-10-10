import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './api/mocks/server';
import { resetFixtures } from './api/mocks/fixtures';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));

afterEach(() => {
  // `globals: false` in vitest.config.ts means RTL's own auto-cleanup (which
  // detects a *global* afterEach) never kicks in, so each render would stack
  // up in the document instead of being unmounted between tests.
  cleanup();
  server.resetHandlers();
  resetFixtures();
});

afterAll(() => server.close());
