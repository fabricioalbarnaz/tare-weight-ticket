import { describe, expect, it } from 'vitest';
import { createDgnFrameParser } from './dgn-frame-parser.js';
import type { ScaleLogger } from './types.js';

function frame(status: string, weightKg: number): string {
  return `${status}${weightKg.toString().padStart(6, '0')}.\r`;
}

function createClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
  };
}

interface CapturedLog {
  level: 'info' | 'warn' | 'debug';
  obj: Record<string, unknown>;
  msg?: string;
}

function createCapturingLogger(): { logger: ScaleLogger; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  return {
    calls,
    logger: {
      info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
      warn: (obj, msg) => calls.push({ level: 'warn', obj, msg }),
      debug: (obj, msg) => calls.push({ level: 'debug', obj, msg }),
    },
  };
}

describe('createDgnFrameParser', () => {
  it('accepts a weight only after 3 matching D frames spaced >= 2000ms apart', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 59080)))).toEqual([{ weightKg: 59080, stable: false }]);

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 59080)))).toEqual([{ weightKg: 59080, stable: false }]);

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 59080)))).toEqual([{ weightKg: 59080, stable: true }]);
  });

  it('treats F (empty platform) the same as D for stability', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    for (let i = 0; i < 3; i += 1) {
      clock.advance(2000);
      parser.push(Buffer.from(frame('F', 0)));
    }

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('F', 0)))).toEqual([{ weightKg: 0, stable: true }]);
  });

  it('never counts @ (oscillating) frames and resets any streak in progress', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 21920)));
    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 21920)));

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('@', 21920)))).toEqual([{ weightKg: 21920, stable: false }]);

    // The streak must restart from zero after the `@` — two more matches
    // (3 total) are needed again, not just one.
    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21920)))).toEqual([{ weightKg: 21920, stable: false }]);
    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21920)))).toEqual([{ weightKg: 21920, stable: false }]);
    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21920)))).toEqual([{ weightKg: 21920, stable: true }]);
  });

  it('never counts an unrecognized status byte (fail-safe) and resets the streak', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 46560)));
    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 46560)));

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('H', 46560)))).toEqual([{ weightKg: 46560, stable: false }]);
    expect(parser.push(Buffer.from(frame('B', 46560)))).toEqual([{ weightKg: 46560, stable: false }]);
  });

  it('rejects a simulated opening burst of thousands of rapid, identical, syntactically-valid D frames', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    // All of this arrives in the same instant (no clock advance), exactly
    // like the field captures: thousands of repeats of the same frame
    // within the first second after opening.
    const burst = frame('D', 59040).repeat(7330);
    const frames = parser.push(Buffer.from(burst));

    expect(frames.length).toBe(7330);
    expect(frames.every((f) => f.stable === false)).toBe(true);
  });

  it('does not let two readings spaced less than the sample interval apart both count', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now, sampleIntervalMs: 2000 });

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 12345)))).toEqual([{ weightKg: 12345, stable: false }]);

    // Only 500ms later: too soon to count as the second reading.
    clock.advance(500);
    expect(parser.push(Buffer.from(frame('D', 12345)))).toEqual([{ weightKg: 12345, stable: false }]);

    // Now far enough from the *first* counted reading (2000ms) to count as the second.
    clock.advance(1500);
    expect(parser.push(Buffer.from(frame('D', 12345)))).toEqual([{ weightKg: 12345, stable: false }]);

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 12345)))).toEqual([{ weightKg: 12345, stable: true }]);
  });

  it('resets the match count when the counted value changes mid-streak', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 20000)));
    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 20000)));

    // A different value arrives as the (would-be) third reading — restarts the streak.
    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21000)))).toEqual([{ weightKg: 21000, stable: false }]);

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21000)))).toEqual([{ weightKg: 21000, stable: false }]);
    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 21000)))).toEqual([{ weightKg: 21000, stable: true }]);
  });

  it('ignores malformed bytes without throwing and resyncs once a real frame arrives', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    const garbage = Buffer.from([0xff, 0x00, 0x01, 0x80, 0x90, 0x0d, 0x0d, 0x0d]);
    expect(() => parser.push(garbage)).not.toThrow();

    clock.advance(2000);
    const frames = parser.push(Buffer.from(frame('D', 58940)));
    expect(frames).toEqual([{ weightKg: 58940, stable: false }]);
  });

  it('does not grow memory unbounded on a long run of CR-less garbage, and still parses the next real frame', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    const longGarbage = Buffer.from('x'.repeat(10_000));
    expect(() => parser.push(longGarbage)).not.toThrow();

    clock.advance(2000);
    expect(parser.push(Buffer.from(frame('D', 1)))).toEqual([{ weightKg: 1, stable: false }]);
  });

  it('buffers a partial frame split across chunks', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    expect(parser.push(Buffer.from('D05908'))).toEqual([]);
    expect(parser.push(Buffer.from('0.\r'))).toEqual([{ weightKg: 59080, stable: false }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const clock = createClock();
    const parser = createDgnFrameParser({ now: clock.now });

    clock.advance(2000);
    const frames = parser.push(Buffer.from(`${frame('D', 100)}${frame('D', 105)}`));
    expect(frames).toEqual([
      { weightKg: 100, stable: false },
      { weightKg: 105, stable: false },
    ]);
  });

  it('logs a warning with the raw bytes when a token does not match the frame pattern, without changing parsing output', () => {
    const clock = createClock();
    const { logger, calls } = createCapturingLogger();
    const parser = createDgnFrameParser({ now: clock.now, logger });

    const garbage = Buffer.from([0xff, 0x00, 0x01, 0x80, 0x90, 0x0d, 0x0d, 0x0d]);
    const frames = parser.push(garbage);

    expect(frames).toEqual([]);
    const warnings = calls.filter((c) => c.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj.tokenHex).toBe(Buffer.from([0xff, 0x00, 0x01, 0x80, 0x90]).toString('hex'));
  });

  it('logs a warning for an unconfirmed/unrecognized status byte, without changing parsing output', () => {
    const clock = createClock();
    const { logger, calls } = createCapturingLogger();
    const parser = createDgnFrameParser({ now: clock.now, logger });

    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 46560)));
    clock.advance(2000);
    parser.push(Buffer.from(frame('D', 46560)));

    clock.advance(2000);
    const frames = parser.push(Buffer.from(frame('H', 46560)));

    expect(frames).toEqual([{ weightKg: 46560, stable: false }]);
    const warnings = calls.filter((c) => c.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj).toEqual({ statusByte: 'H', weightKg: 46560 });
  });

  it('logs a warning when the frame buffer overflows and is dropped', () => {
    const clock = createClock();
    const { logger, calls } = createCapturingLogger();
    const parser = createDgnFrameParser({ now: clock.now, logger });

    const longGarbage = Buffer.from('x'.repeat(10_000));
    parser.push(longGarbage);

    const warnings = calls.filter((c) => c.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj.droppedLength).toBe(10_000);
  });
});
