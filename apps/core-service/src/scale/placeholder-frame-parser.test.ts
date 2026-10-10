import { describe, expect, it } from 'vitest';
import { createPlaceholderFrameParser } from './placeholder-frame-parser.js';

describe('createPlaceholderFrameParser', () => {
  it('parses a single stable frame', () => {
    const parser = createPlaceholderFrameParser();

    const frames = parser.push(Buffer.from('ST,12345.5\n'));

    expect(frames).toEqual([{ weightKg: 12345.5, stable: true }]);
  });

  it('parses a single unstable frame', () => {
    const parser = createPlaceholderFrameParser();

    const frames = parser.push(Buffer.from('US,100\n'));

    expect(frames).toEqual([{ weightKg: 100, stable: false }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const parser = createPlaceholderFrameParser();

    const frames = parser.push(Buffer.from('US,100\nUS,105\nST,110\n'));

    expect(frames).toEqual([
      { weightKg: 100, stable: false },
      { weightKg: 105, stable: false },
      { weightKg: 110, stable: true },
    ]);
  });

  it('buffers a partial frame split across chunks', () => {
    const parser = createPlaceholderFrameParser();

    expect(parser.push(Buffer.from('ST,123'))).toEqual([]);
    expect(parser.push(Buffer.from('45\n'))).toEqual([{ weightKg: 12345, stable: true }]);
  });

  it('ignores malformed lines without throwing', () => {
    const parser = createPlaceholderFrameParser();

    const frames = parser.push(Buffer.from('garbage\nST,not-a-number\nST,42\n'));

    expect(frames).toEqual([{ weightKg: 42, stable: true }]);
  });

  it('ignores blank lines', () => {
    const parser = createPlaceholderFrameParser();

    const frames = parser.push(Buffer.from('\n\nST,1\n'));

    expect(frames).toEqual([{ weightKg: 1, stable: true }]);
  });
});
