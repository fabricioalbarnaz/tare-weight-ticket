import { describe, expect, it } from 'vitest';
import { loadScaleConfig } from './config.js';

describe('loadScaleConfig', () => {
  it('falls back to defaults when no env vars are set', () => {
    expect(loadScaleConfig({})).toEqual({
      host: '127.0.0.1',
      port: 9000,
      stabilityTimeoutMs: 15000,
      connectTimeoutMs: 5000,
      stabilityReadingCount: 3,
      stabilitySampleIntervalMs: 2000,
    });
  });

  it('reads values from the given env', () => {
    expect(
      loadScaleConfig({
        SCALE_HOST: '10.0.0.5',
        SCALE_PORT: '4001',
        SCALE_STABILITY_TIMEOUT_MS: '20000',
        SCALE_CONNECT_TIMEOUT_MS: '3000',
        SCALE_STABILITY_READING_COUNT: '5',
        SCALE_STABILITY_SAMPLE_INTERVAL_MS: '1000',
      }),
    ).toEqual({
      host: '10.0.0.5',
      port: 4001,
      stabilityTimeoutMs: 20000,
      connectTimeoutMs: 3000,
      stabilityReadingCount: 5,
      stabilitySampleIntervalMs: 1000,
    });
  });

  it('throws when SCALE_PORT is not a positive integer', () => {
    expect(() => loadScaleConfig({ SCALE_PORT: 'not-a-number' })).toThrow(/SCALE_PORT/);
  });

  it('throws when a numeric env var is an empty string', () => {
    expect(() => loadScaleConfig({ SCALE_PORT: '' })).toThrow(/SCALE_PORT/);
  });

  it('throws when a numeric env var is zero or negative', () => {
    expect(() => loadScaleConfig({ SCALE_STABILITY_TIMEOUT_MS: '0' })).toThrow(
      /SCALE_STABILITY_TIMEOUT_MS/,
    );
    expect(() => loadScaleConfig({ SCALE_CONNECT_TIMEOUT_MS: '-5' })).toThrow(
      /SCALE_CONNECT_TIMEOUT_MS/,
    );
  });

  it('throws when a numeric env var is not an integer', () => {
    expect(() => loadScaleConfig({ SCALE_PORT: '4001.5' })).toThrow(/SCALE_PORT/);
  });
});
