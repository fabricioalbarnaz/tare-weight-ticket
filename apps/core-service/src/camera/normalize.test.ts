import { describe, expect, it } from 'vitest';
import { isReliablePlateRead, normalizeCameraPayload } from './normalize.js';
import type { AnprXmlEvent } from './anpr-xml.js';

function makeEvent(overrides: Partial<AnprXmlEvent> = {}): AnprXmlEvent {
  return {
    deviceId: '88',
    dateTime: '2026-01-01T08:00:00.000Z',
    licensePlate: 'ABC1234',
    confidenceLevel: 96,
    plateCharBelieve: [99, 99, 99, 99, 99, 99, 99],
    direction: 'reverse',
    country: '156',
    ...overrides,
  };
}

describe('isReliablePlateRead', () => {
  it('accepts a 7-character plate at or above the confidence threshold', () => {
    expect(isReliablePlateRead('ABC1234', 80)).toBe(true);
    expect(isReliablePlateRead('ABC1234', 96)).toBe(true);
  });

  it('rejects below the confidence threshold', () => {
    expect(isReliablePlateRead('ABC1234', 79)).toBe(false);
  });

  it('rejects a plate shorter than 7 characters even at high confidence', () => {
    expect(isReliablePlateRead('V0694', 99)).toBe(false);
  });

  it('rejects a plate longer than 7 characters', () => {
    expect(isReliablePlateRead('ABC12345', 99)).toBe(false);
  });
});

describe('normalizeCameraPayload', () => {
  it('maps a reliable read through to rawPlate/cameraId/timestamp', () => {
    const result = normalizeCameraPayload(makeEvent());

    expect(result).toEqual({
      rawPlate: 'ABC1234',
      cameraId: '88',
      timestamp: new Date('2026-01-01T08:00:00.000Z'),
    });
  });

  it('blanks rawPlate when confidence is below the threshold', () => {
    const result = normalizeCameraPayload(makeEvent({ confidenceLevel: 50 }));

    expect(result.rawPlate).toBe('');
  });

  it('blanks rawPlate when the plate is shorter than expected (likely truncated read)', () => {
    const result = normalizeCameraPayload(makeEvent({ licensePlate: 'V0694', confidenceLevel: 99 }));

    expect(result.rawPlate).toBe('');
  });

  it('normalizes plate casing/punctuation before the length check', () => {
    const result = normalizeCameraPayload(makeEvent({ licensePlate: 'abc-1234' }));

    expect(result.rawPlate).toBe('ABC1234');
  });

  it('falls back to now when dateTime is unparsable', () => {
    const before = Date.now();
    const result = normalizeCameraPayload(makeEvent({ dateTime: 'not-a-date' }));
    const after = Date.now();

    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });
});
