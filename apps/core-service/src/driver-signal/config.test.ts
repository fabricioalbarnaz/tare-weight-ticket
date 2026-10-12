import { describe, expect, it } from 'vitest';
import { loadDriverSignalConfig } from './config.js';

describe('loadDriverSignalConfig', () => {
  it('disables both directions and uses the default timeout when unset', () => {
    expect(loadDriverSignalConfig({})).toEqual({
      entranceUrl: undefined,
      exitUrl: undefined,
      timeoutMs: 3000,
    });
  });

  it('reads values from the given env', () => {
    expect(
      loadDriverSignalConfig({
        DRIVER_SIGNAL_URL_ENTRANCE: 'http://relay.local/in',
        DRIVER_SIGNAL_URL_EXIT: 'http://relay.local/out',
        DRIVER_SIGNAL_TIMEOUT_MS: '1500',
      }),
    ).toEqual({
      entranceUrl: 'http://relay.local/in',
      exitUrl: 'http://relay.local/out',
      timeoutMs: 1500,
    });
  });

  it('throws when a configured URL is malformed', () => {
    expect(() => loadDriverSignalConfig({ DRIVER_SIGNAL_URL_ENTRANCE: 'not a url' })).toThrow(
      /DRIVER_SIGNAL_URL_ENTRANCE/,
    );
  });

  it('throws when the timeout is not a positive integer', () => {
    expect(() => loadDriverSignalConfig({ DRIVER_SIGNAL_TIMEOUT_MS: '0' })).toThrow(
      /DRIVER_SIGNAL_TIMEOUT_MS/,
    );
  });
});
