import { describe, expect, it } from 'vitest';
import { loadBridgeConfig } from './config.js';

describe('loadBridgeConfig', () => {
  it('falls back to defaults besides the required COM port', () => {
    expect(loadBridgeConfig({ SCALE_BRIDGE_COM_PORT: 'COM3' })).toEqual({
      comPort: 'COM3',
      baudRate: 9600,
      relayPort: 9000,
      healthPort: 4100,
    });
  });

  it('reads values from the given env', () => {
    expect(
      loadBridgeConfig({
        SCALE_BRIDGE_COM_PORT: 'COM5',
        SCALE_BRIDGE_BAUD_RATE: '4800',
        SCALE_BRIDGE_RELAY_PORT: '9100',
        SCALE_BRIDGE_HEALTH_PORT: '4200',
      }),
    ).toEqual({
      comPort: 'COM5',
      baudRate: 4800,
      relayPort: 9100,
      healthPort: 4200,
    });
  });

  it('throws when SCALE_BRIDGE_COM_PORT is missing', () => {
    expect(() => loadBridgeConfig({})).toThrow(/SCALE_BRIDGE_COM_PORT/);
  });

  it('throws when a numeric env var is not a positive integer', () => {
    expect(() =>
      loadBridgeConfig({ SCALE_BRIDGE_COM_PORT: 'COM3', SCALE_BRIDGE_BAUD_RATE: 'fast' }),
    ).toThrow(/SCALE_BRIDGE_BAUD_RATE/);
  });
});
