import { describe, expect, it } from 'vitest';
import { loadTicketConfig } from './config.js';

describe('loadTicketConfig', () => {
  it('falls back to the defaults when no env var is set', () => {
    expect(loadTicketConfig({})).toEqual({
      reweighWindowMs: 2 * 60 * 60 * 1000,
      plateDeductionWindowMs: 24 * 60 * 60 * 1000,
    });
  });

  it('reads the values from the given env', () => {
    expect(
      loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: '3600000', PLATE_DEDUCTION_WINDOW_MS: '7200000' }),
    ).toEqual({ reweighWindowMs: 3600000, plateDeductionWindowMs: 7200000 });
  });

  it('throws when a window env var is not a positive integer', () => {
    expect(() => loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: 'nope' })).toThrow(/EXIT_REWEIGH_WINDOW_MS/);
    expect(() => loadTicketConfig({ EXIT_REWEIGH_WINDOW_MS: '0' })).toThrow(/EXIT_REWEIGH_WINDOW_MS/);
    expect(() => loadTicketConfig({ PLATE_DEDUCTION_WINDOW_MS: 'nope' })).toThrow(/PLATE_DEDUCTION_WINDOW_MS/);
    expect(() => loadTicketConfig({ PLATE_DEDUCTION_WINDOW_MS: '0' })).toThrow(/PLATE_DEDUCTION_WINDOW_MS/);
  });
});
