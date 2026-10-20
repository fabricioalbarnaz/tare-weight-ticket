import { parsePositiveInt } from '../config/env.js';

export interface ScaleConfig {
  host: string;
  port: number;
  stabilityTimeoutMs: number;
  connectTimeoutMs: number;
  /** Consecutive matching, spaced-apart DGN readings required before a weight counts as stable (see dgn-frame-parser.ts). */
  stabilityReadingCount: number;
  /** Minimum time (ms) between two DGN readings that both count toward that streak. */
  stabilitySampleIntervalMs: number;
}

export function loadScaleConfig(env: NodeJS.ProcessEnv = process.env): ScaleConfig {
  return {
    host: env.SCALE_HOST ?? '127.0.0.1',
    port: parsePositiveInt('SCALE_PORT', env.SCALE_PORT, 9000),
    stabilityTimeoutMs: parsePositiveInt(
      'SCALE_STABILITY_TIMEOUT_MS',
      env.SCALE_STABILITY_TIMEOUT_MS,
      15000,
    ),
    connectTimeoutMs: parsePositiveInt('SCALE_CONNECT_TIMEOUT_MS', env.SCALE_CONNECT_TIMEOUT_MS, 5000),
    stabilityReadingCount: parsePositiveInt(
      'SCALE_STABILITY_READING_COUNT',
      env.SCALE_STABILITY_READING_COUNT,
      3,
    ),
    stabilitySampleIntervalMs: parsePositiveInt(
      'SCALE_STABILITY_SAMPLE_INTERVAL_MS',
      env.SCALE_STABILITY_SAMPLE_INTERVAL_MS,
      2000,
    ),
  };
}
