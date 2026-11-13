import { describe, expect, it } from 'vitest';
import { loadTicketConfig } from './config.js';

describe('loadTicketConfig', () => {
  it('falls back to the default when no env var is set', () => {
    expect(loadTicketConfig({})).toEqual({ reweighWindowMs: 2 * 60 * 60 * 1000 });
  });

  it('reads the value from the given env', () => {
    expect(loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: '3600000' })).toEqual({ reweighWindowMs: 3600000 });
  });

  it('throws when the env var is not a positive integer', () => {
    expect(() => loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: 'nope' })).toThrow(/EXIT_REWEIGH_WINDOW_MS/);
    expect(() => loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: '0' })).toThrow(/EXIT_REWEIGH_WINDOW_MS/);
  });
});
