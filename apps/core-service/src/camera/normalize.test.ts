import { describe, expect, it } from 'vitest';
import { normalizeCameraPayload } from './normalize.js';

describe('normalizeCameraPayload', () => {
  it('maps plate, cameraId, and timestamp through', () => {
    const result = normalizeCameraPayload({
      plate: 'ABC1234',
      cameraId: 'cam-entrance-1',
      timestamp: '2026-01-01T08:00:00.000Z',
    });

    expect(result).toEqual({
      rawPlate: 'ABC1234',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00.000Z'),
    });
  });

  it('defaults rawPlate to an empty string when plate is missing', () => {
    const result = normalizeCameraPayload({ cameraId: 'cam-entrance-1' });

    expect(result.rawPlate).toBe('');
  });

  it('defaults rawPlate to an empty string when plate is null', () => {
    const result = normalizeCameraPayload({ plate: null, cameraId: 'cam-entrance-1' });

    expect(result.rawPlate).toBe('');
  });

  it('defaults timestamp to now when missing', () => {
    const before = Date.now();
    const result = normalizeCameraPayload({ cameraId: 'cam-entrance-1' });
    const after = Date.now();

    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });
});
