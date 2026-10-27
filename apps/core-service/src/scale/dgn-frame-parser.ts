import type { ParsedWeightFrame, ScaleFrameParser, ScaleLogger } from './types.js';

/**
 * Real Digi-Tron Isis New DGN continuous-serial frame parser (see
 * docs/runbooks/isis-new-serial-setup.md). Frame shape, confirmed against
 * the operator's display in repeated field captures: one status byte, six
 * numeric digits, a literal '.', terminated by CR (0x0D) — e.g.
 * `D059080.\r` for a stable 59080 kg reading.
 *
 * The status-byte semantics and the opening-burst behavior below are
 * explicit, documented provisional assumptions (not a vendor-confirmed
 * DGN spec) — see the runbook's still-open validation checklist before
 * treating this as a finished integration.
 */

const FRAME_PATTERN = /^(.)(\d{6})\.$/;
const CANDIDATE_STATUSES = new Set(['D', 'F']);

// A well-formed token is 8 bytes. If no CR has shown up within well more
// than that, something is wrong (e.g. a burst dropping CRs) — the buffer is
// dropped entirely rather than trimmed to a tail, since keeping a tail would
// silently glue leftover garbage onto the front of the next real frame and
// corrupt an otherwise-valid reading instead of just discarding one.
const MAX_BUFFER_LENGTH = 64;

const noopLogger: ScaleLogger = {
  info() {},
  warn() {},
  debug() {},
};

/** `latin1` round-trips 1:1 with the raw bytes (see push() below), so this recovers the original bytes exactly for logging. */
function toHex(token: string): string {
  return Buffer.from(token, 'latin1').toString('hex');
}

export interface DgnFrameParserOptions {
  /**
   * Minimum time (ms) between two readings that both count toward the
   * stability streak. Also gates the very first countable reading, anchored
   * to when the parser was constructed (i.e. when the connection opened) —
   * this is what keeps the opening burst's rapid, syntactically-valid
   * repeated frames from ever satisfying the match count. Default 2000.
   */
  sampleIntervalMs?: number;
  /** Number of matching, spaced-apart readings required before a weight is accepted as stable. Default 3. */
  requiredMatches?: number;
  /** Injectable clock, for deterministic tests without fake timers. Defaults to Date.now. */
  now?: () => number;
  /**
   * Logs frames/bytes this parser doesn't recognize or doesn't trust yet —
   * the one place the still-unconfirmed state-byte semantics (see the
   * module doc comment above) would actually show up. Defaults to a no-op.
   */
  logger?: ScaleLogger;
}

export function createDgnFrameParser(options: DgnFrameParserOptions = {}): ScaleFrameParser {
  const sampleIntervalMs = options.sampleIntervalMs ?? 2000;
  const requiredMatches = options.requiredMatches ?? 3;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? noopLogger;

  let buffer = '';
  let lastCountedAt = now();
  let currentValue: number | null = null;
  let matchCount = 0;

  function classify(token: string): ParsedWeightFrame | undefined {
    const match = FRAME_PATTERN.exec(token);
    if (!match) {
      // An empty token between two adjacent CRs is a benign stray
      // delimiter, not an anomaly — only log tokens that actually carried
      // unrecognized bytes.
      if (token.length > 0) {
        logger.warn({ tokenHex: toHex(token) }, 'scale: unrecognized frame, discarding');
      }
      return undefined;
    }

    const [, statusByte, digits] = match;
    // The regex's two capturing groups always populate alongside a
    // successful match; this is just satisfying noUncheckedIndexedAccess.
    if (statusByte === undefined || digits === undefined) return undefined;

    const weightKg = Number(digits);
    if (!Number.isFinite(weightKg)) return undefined;

    if (!CANDIDATE_STATUSES.has(statusByte)) {
      // `@` (oscillating) or any byte not yet confirmed (`B`, `H`, ...):
      // fail-safe — never counts toward stability, and breaks any streak
      // in progress. Logged because this is exactly where the documented,
      // vendor-unconfirmed status-byte assumption would show up in the field.
      logger.warn({ statusByte, weightKg }, 'scale: unconfirmed status byte, not counted toward stability');
      currentValue = null;
      matchCount = 0;
      return { weightKg, stable: false };
    }

    const timestamp = now();
    if (timestamp - lastCountedAt < sampleIntervalMs) {
      // Too soon after the last counted reading — this is exactly the
      // opening-burst shape (thousands of valid-looking repeats within
      // milliseconds), so it's never allowed to count.
      return { weightKg, stable: matchCount >= requiredMatches && currentValue === weightKg };
    }

    lastCountedAt = timestamp;
    if (currentValue === weightKg) {
      matchCount += 1;
    } else {
      currentValue = weightKg;
      matchCount = 1;
    }

    return { weightKg, stable: matchCount >= requiredMatches };
  }

  return {
    push(chunk) {
      // latin1: a 1:1 byte-to-char-code mapping, so arbitrary/malformed
      // burst bytes (including non-ASCII ones) decode without throwing or
      // producing replacement characters, unlike utf8.
      buffer += chunk.toString('latin1');
      const frames: ParsedWeightFrame[] = [];

      let crIndex = buffer.indexOf('\r');
      while (crIndex !== -1) {
        const token = buffer.slice(0, crIndex);
        buffer = buffer.slice(crIndex + 1);

        const frame = classify(token);
        if (frame) frames.push(frame);

        crIndex = buffer.indexOf('\r');
      }

      if (buffer.length > MAX_BUFFER_LENGTH) {
        logger.warn(
          { droppedLength: buffer.length, droppedHex: toHex(buffer) },
          'scale: frame buffer overflow, dropping buffered bytes',
        );
        buffer = '';
      }

      return frames;
    },
  };
}
