import { describe, expect, it } from 'vitest';
import { normalizePlate } from './plate.js';

describe('normalizePlate', () => {
  it('uppercases and strips surrounding whitespace', () => {
    expect(normalizePlate('  abc1234  ')).toBe('ABC1234');
  });

  it('strips dashes and internal spaces from mixed formats', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234');
    expect(normalizePlate('ABC 1D23')).toBe('ABC1D23');
  });

  it('returns an empty string for whitespace-only or unreadable input', () => {
    expect(normalizePlate('   ')).toBe('');
    expect(normalizePlate('')).toBe('');
    expect(normalizePlate('---')).toBe('');
  });
});
