import { describe, expect, it } from 'vitest';
import { findSingleCharDifferenceIndex, normalizePlate } from './plate.js';

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

describe('findSingleCharDifferenceIndex', () => {
  it('returns null for identical strings', () => {
    expect(findSingleCharDifferenceIndex('RKZ6F83', 'RKZ6F83')).toBeNull();
  });

  it('returns the differing index for a single-character substitution, at every position', () => {
    expect(findSingleCharDifferenceIndex('RKZ6F83', 'RK76F83')).toBe(2);
    expect(findSingleCharDifferenceIndex('JAP4G45', 'JAD4G45')).toBe(2);
    expect(findSingleCharDifferenceIndex('JAL8I68', 'JAL8368')).toBe(4);
    expect(findSingleCharDifferenceIndex('ITX3F22', 'ITX3F02')).toBe(5);
  });

  it('returns null when more than one character differs', () => {
    expect(findSingleCharDifferenceIndex('RKZ6F83', 'RK769F3')).toBeNull();
  });

  it('returns null for different-length strings', () => {
    expect(findSingleCharDifferenceIndex('RKZ6F83', 'RKZ6F8')).toBeNull();
    expect(findSingleCharDifferenceIndex('RKZ6F83', 'RKZ6F831')).toBeNull();
  });
});
