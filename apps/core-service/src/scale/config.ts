import { parsePositiveInt } from '../config/env.js';

export interface ScaleConfig {
  host: string;
  port: number;
  stabilityTimeoutMs: number;
  connectTimeoutMs: number;
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
  };
}
