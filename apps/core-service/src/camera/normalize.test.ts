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
    expect(isReliablePlateRead('ABC1234', 70)).toBe(true);
    expect(isReliablePlateRead('ABC1234', 96)).toBe(true);
  });

  it('rejects below the confidence threshold', () => {
    expect(isReliablePlateRead('ABC1234', 69)).toBe(false);
  });

  // 2026-11-18: the length check was removed at the user's explicit
  // request — see master plan §7/§11. Confidence is now the only factor.
  it('accepts a plate shorter than 7 characters at or above the confidence threshold', () => {
    expect(isReliablePlateRead('V0694', 99)).toBe(true);
  });

  it('accepts a plate longer than 7 characters at or above the confidence threshold', () => {
    expect(isReliablePlateRead('ABC12345', 99)).toBe(true);
  });
});

describe('normalizeCameraPayload', () => {
  it('maps a reliable read through to rawPlate/cameraId/timestamp, with the camera read quality', () => {
    const result = normalizeCameraPayload(makeEvent());

    expect(result).toEqual({
      rawPlate: 'ABC1234',
      cameraId: '88',
      timestamp: new Date('2026-01-01T08:00:00.000Z'),
      readQuality: { readPlate: 'ABC1234', confidenceLevel: 96, plateCharBelieve: [99, 99, 99, 99, 99, 99, 99] },
    });
  });

  it('blanks rawPlate when confidence is below the threshold', () => {
    const result = normalizeCameraPayload(makeEvent({ confidenceLevel: 50 }));

    expect(result.rawPlate).toBe('');
  });

  it('keeps what the camera read in readQuality even when the read is judged unreadable', () => {
    const result = normalizeCameraPayload(
      makeEvent({ licensePlate: 'ggg-8319', confidenceLevel: 62, plateCharBelieve: [41, 98, 97, 99, 99, 99, 99] }),
    );

    expect(result.rawPlate).toBe('');
    expect(result.readQuality).toEqual({
      readPlate: 'GGG8319',
      confidenceLevel: 62,
      plateCharBelieve: [41, 98, 97, 99, 99, 99, 99],
    });
  });

  // 2026-11-18: previously blanked (likely-truncated-read guard, now
  // removed at the user's explicit request — see master plan §7/§11).
  it('keeps rawPlate for a shorter-than-usual plate at high confidence', () => {
    const result = normalizeCameraPayload(makeEvent({ licensePlate: 'V0694', confidenceLevel: 99 }));

    expect(result.rawPlate).toBe('V0694');
  });

  it('normalizes plate casing/punctuation', () => {
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
