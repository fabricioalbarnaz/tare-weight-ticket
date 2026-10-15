import { describe, expect, it } from 'vitest';
import { parseOptionalUrl, parsePositiveInt, parseRequiredSecret } from './env.js';

describe('parsePositiveInt', () => {
  it('returns the fallback when the value is undefined', () => {
    expect(parsePositiveInt('X', undefined, 42)).toBe(42);
  });

  it('parses a valid positive integer string', () => {
    expect(parsePositiveInt('X', '10', 42)).toBe(10);
  });

  it('throws on a non-numeric value', () => {
    expect(() => parsePositiveInt('X', 'abc', 42)).toThrow(/X/);
  });

  it('throws on an empty string', () => {
    expect(() => parsePositiveInt('X', '', 42)).toThrow(/X/);
  });

  it('throws on zero or a negative value', () => {
    expect(() => parsePositiveInt('X', '0', 42)).toThrow(/X/);
    expect(() => parsePositiveInt('X', '-1', 42)).toThrow(/X/);
  });

  it('throws on a non-integer value', () => {
    expect(() => parsePositiveInt('X', '1.5', 42)).toThrow(/X/);
  });
});

describe('parseOptionalUrl', () => {
  it('returns undefined when the value is unset', () => {
    expect(parseOptionalUrl('X', undefined)).toBeUndefined();
  });

  it('returns undefined when the value is an empty string', () => {
    expect(parseOptionalUrl('X', '')).toBeUndefined();
  });

  it('returns the value when it is a valid URL', () => {
    expect(parseOptionalUrl('X', 'http://127.0.0.1:8080/relay')).toBe('http://127.0.0.1:8080/relay');
  });

  it('throws when the value is not a valid URL', () => {
    expect(() => parseOptionalUrl('X', 'not a url')).toThrow(/X/);
  });
});

describe('parseRequiredSecret', () => {
  it('returns the value when it meets the minimum length', () => {
    expect(parseRequiredSecret('X', 'a'.repeat(32), 32)).toBe('a'.repeat(32));
  });

  it('throws when the value is unset', () => {
    expect(() => parseRequiredSecret('X', undefined, 32)).toThrow(/X/);
  });

  it('throws when the value is shorter than the minimum length', () => {
    expect(() => parseRequiredSecret('X', 'short', 32)).toThrow(/X/);
  });
});
