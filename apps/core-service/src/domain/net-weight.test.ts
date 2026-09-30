import { describe, expect, it } from 'vitest';
import { calculateNetWeightKg } from './net-weight.js';

describe('calculateNetWeightKg', () => {
  it('computes the net weight when the truck arrives loaded and leaves empty', () => {
    expect(calculateNetWeightKg(20000, 8000)).toBe(12000);
  });

  it('computes the net weight when the truck arrives empty and leaves loaded', () => {
    expect(calculateNetWeightKg(8000, 20000)).toBe(12000);
  });

  it('returns 0 when entry and exit weights are equal', () => {
    expect(calculateNetWeightKg(15000, 15000)).toBe(0);
  });

  it('rounds to 2 decimal places to avoid floating point noise', () => {
    // 100.3 - 100.2 === 0.09999999999999432 in raw JS float arithmetic.
    expect(calculateNetWeightKg(100.3, 100.2)).toBe(0.1);
  });
});
