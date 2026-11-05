import { describe, expect, it } from 'vitest';
import { loadDriverSignalConfig } from './config.js';

describe('loadDriverSignalConfig', () => {
  it('defaults to the http-relay adapter, disables both directions, and uses default timeouts when unset', () => {
    expect(loadDriverSignalConfig({})).toEqual({
      adapter: 'http-relay',
      entranceUrl: undefined,
      exitUrl: undefined,
      timeoutMs: 3000,
      hikvisionEntrance: undefined,
      hikvisionExit: undefined,
    });
  });

  it('reads http-relay values from the given env', () => {
    expect(
      loadDriverSignalConfig({
        DRIVER_SIGNAL_URL_ENTRANCE: 'http://relay.local/in',
        DRIVER_SIGNAL_URL_EXIT: 'http://relay.local/out',
        DRIVER_SIGNAL_TIMEOUT_MS: '1500',
      }),
    ).toEqual({
      adapter: 'http-relay',
      entranceUrl: 'http://relay.local/in',
      exitUrl: 'http://relay.local/out',
      timeoutMs: 1500,
      hikvisionEntrance: undefined,
      hikvisionExit: undefined,
    });
  });

  it('throws when a configured relay URL is malformed', () => {
    expect(() => loadDriverSignalConfig({ DRIVER_SIGNAL_URL_ENTRANCE: 'not a url' })).toThrow(
      /DRIVER_SIGNAL_URL_ENTRANCE/,
    );
  });

  it('throws when the timeout is not a positive integer', () => {
    expect(() => loadDriverSignalConfig({ DRIVER_SIGNAL_TIMEOUT_MS: '0' })).toThrow(
      /DRIVER_SIGNAL_TIMEOUT_MS/,
    );
  });

  describe('DRIVER_SIGNAL_ADAPTER', () => {
    it('accepts "hikvision-isapi"', () => {
      expect(loadDriverSignalConfig({ DRIVER_SIGNAL_ADAPTER: 'hikvision-isapi' }).adapter).toBe(
        'hikvision-isapi',
      );
    });

    it('throws on an unrecognized value', () => {
      expect(() => loadDriverSignalConfig({ DRIVER_SIGNAL_ADAPTER: 'something-else' })).toThrow(
        /DRIVER_SIGNAL_ADAPTER/,
      );
    });
  });

  describe('hikvision camera config', () => {
    it('loads a fully configured entrance camera, defaulting channelId to "1" and ctrlMode to "open"', () => {
      const config = loadDriverSignalConfig({
        DRIVER_SIGNAL_HIKVISION_ENTRANCE_URL: 'http://192.168.1.10',
        DRIVER_SIGNAL_HIKVISION_ENTRANCE_USERNAME: 'admin',
        DRIVER_SIGNAL_HIKVISION_ENTRANCE_PASSWORD: 'admin12345',
      });

      expect(config.hikvisionEntrance).toEqual({
        baseUrl: 'http://192.168.1.10',
        channelId: '1',
        ctrlMode: 'open',
        username: 'admin',
        password: 'admin12345',
      });
      expect(config.hikvisionExit).toBeUndefined();
    });

    it('loads a fully configured exit camera independently of the entrance camera, with an explicit channel/ctrlMode', () => {
      const config = loadDriverSignalConfig({
        DRIVER_SIGNAL_HIKVISION_EXIT_URL: 'http://192.168.1.11',
        DRIVER_SIGNAL_HIKVISION_EXIT_CHANNEL_ID: '1',
        DRIVER_SIGNAL_HIKVISION_EXIT_CTRL_MODE: 'close',
        DRIVER_SIGNAL_HIKVISION_EXIT_USERNAME: 'admin',
        DRIVER_SIGNAL_HIKVISION_EXIT_PASSWORD: 'admin12345',
      });

      expect(config.hikvisionExit).toEqual({
        baseUrl: 'http://192.168.1.11',
        channelId: '1',
        ctrlMode: 'close',
        username: 'admin',
        password: 'admin12345',
      });
      expect(config.hikvisionEntrance).toBeUndefined();
    });

    it('throws when the camera URL is set but the username is missing', () => {
      expect(() =>
        loadDriverSignalConfig({
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_URL: 'http://192.168.1.10',
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_PASSWORD: 'admin12345',
        }),
      ).toThrow(/DRIVER_SIGNAL_HIKVISION_ENTRANCE_USERNAME/);
    });

    it('throws when the camera URL is set but the password is missing', () => {
      expect(() =>
        loadDriverSignalConfig({
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_URL: 'http://192.168.1.10',
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_USERNAME: 'admin',
        }),
      ).toThrow(/DRIVER_SIGNAL_HIKVISION_ENTRANCE_PASSWORD/);
    });

    it('throws when ctrlMode is not one of open/close/lock/unlock', () => {
      expect(() =>
        loadDriverSignalConfig({
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_URL: 'http://192.168.1.10',
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_USERNAME: 'admin',
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_PASSWORD: 'admin12345',
          DRIVER_SIGNAL_HIKVISION_ENTRANCE_CTRL_MODE: 'open-sesame',
        }),
      ).toThrow(/DRIVER_SIGNAL_HIKVISION_ENTRANCE_CTRL_MODE/);
    });
  });
});
