import { describe, expect, it } from 'vitest';
import { loadScaleConfig } from './config.js';

describe('loadScaleConfig', () => {
  it('falls back to defaults when no env vars are set', () => {
    expect(loadScaleConfig({})).toEqual({
      host: '127.0.0.1',
      port: 9000,
      stabilityTimeoutMs: 15000,
      connectTimeoutMs: 5000,
    });
  });

  it('reads values from the given env', () => {
    expect(
      loadScaleConfig({
        SCALE_HOST: '10.0.0.5',
        SCALE_PORT: '4001',
        SCALE_STABILITY_TIMEOUT_MS: '20000',
        SCALE_CONNECT_TIMEOUT_MS: '3000',
      }),
    ).toEqual({
      host: '10.0.0.5',
      port: 4001,
      stabilityTimeoutMs: 20000,
      connectTimeoutMs: 3000,
    });
  });
});
