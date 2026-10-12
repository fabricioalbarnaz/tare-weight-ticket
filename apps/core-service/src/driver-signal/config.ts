import { parseOptionalUrl, parsePositiveInt } from '../config/env.js';

export interface DriverSignalConfig {
  entranceUrl?: string;
  exitUrl?: string;
  timeoutMs: number;
}

export function loadDriverSignalConfig(env: NodeJS.ProcessEnv = process.env): DriverSignalConfig {
  return {
    entranceUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_ENTRANCE', env.DRIVER_SIGNAL_URL_ENTRANCE),
    exitUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_EXIT', env.DRIVER_SIGNAL_URL_EXIT),
    timeoutMs: parsePositiveInt('DRIVER_SIGNAL_TIMEOUT_MS', env.DRIVER_SIGNAL_TIMEOUT_MS, 3000),
  };
}
