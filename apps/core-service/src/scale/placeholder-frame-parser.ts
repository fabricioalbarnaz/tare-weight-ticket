import type { ParsedWeightFrame, ScaleFrameParser } from './types.js';

/**
 * Placeholder frame parser, used until the Digi-Tron Isis New protocol
 * manual is available (see docs/plans master plan §7.2). This is NOT the
 * real Isis New wire format — it exists so the stability-wait logic, TCP
 * client, and session wiring can be built and tested now, and gets
 * swapped for the real parser once the manual or hardware access arrives.
 *
 * Frame format: ASCII lines terminated by '\n', `<ST|US>,<weightKg>`,
 * e.g. `ST,12345.5` (stable) or `US,12340.0` (unstable).
 */
export function createPlaceholderFrameParser(): ScaleFrameParser {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunk.toString('utf8');
      const frames: ParsedWeightFrame[] = [];

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        const frame = parseLine(line);
        if (frame) frames.push(frame);

        newlineIndex = buffer.indexOf('\n');
      }

      return frames;
    },
  };
}

function parseLine(line: string): ParsedWeightFrame | undefined {
  if (line === '') return undefined;

  const [flag, weightStr] = line.split(',');
  if (flag !== 'ST' && flag !== 'US') return undefined;

  const weightKg = Number(weightStr);
  if (!Number.isFinite(weightKg)) return undefined;

  return { weightKg, stable: flag === 'ST' };
}
