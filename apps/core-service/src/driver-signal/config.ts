import { parseOptionalUrl, parsePositiveInt } from '../config/env.js';

export type DriverSignalAdapterKind = 'http-relay' | 'hikvision-isapi';

export interface HikvisionIsapiCameraConfig {
  baseUrl: string;
  outputId: string;
  username: string;
  password: string;
}

export interface DriverSignalConfig {
  adapter: DriverSignalAdapterKind;
  entranceUrl?: string;
  exitUrl?: string;
  timeoutMs: number;
  hikvisionEntrance?: HikvisionIsapiCameraConfig;
  hikvisionExit?: HikvisionIsapiCameraConfig;
  hikvisionPulseMs: number;
}

function parseAdapterKind(value: string | undefined): DriverSignalAdapterKind {
  if (!value || value === 'http-relay') return 'http-relay';
  if (value === 'hikvision-isapi') return 'hikvision-isapi';
  throw new Error(`Invalid DRIVER_SIGNAL_ADAPTER: "${value}" (expected "http-relay" or "hikvision-isapi")`);
}

// Each camera is configured as a group (URL + output ID + credentials); an
// unset URL disables that direction (same convention as the http-relay
// adapter's entranceUrl/exitUrl), but a set URL with a missing sibling
// field is a misconfiguration, not a partially-disabled direction.
function loadHikvisionCamera(prefix: string, env: NodeJS.ProcessEnv): HikvisionIsapiCameraConfig | undefined {
  const urlVar = `${prefix}_URL`;
  const baseUrl = parseOptionalUrl(urlVar, env[urlVar]);
  if (!baseUrl) return undefined;

  const outputId = env[`${prefix}_OUTPUT_ID`];
  if (!outputId) throw new Error(`Missing required env var ${prefix}_OUTPUT_ID (required when ${urlVar} is set)`);

  const username = env[`${prefix}_USERNAME`];
  if (!username) throw new Error(`Missing required env var ${prefix}_USERNAME (required when ${urlVar} is set)`);

  const password = env[`${prefix}_PASSWORD`];
  if (!password) throw new Error(`Missing required env var ${prefix}_PASSWORD (required when ${urlVar} is set)`);

  return { baseUrl, outputId, username, password };
}

export function loadDriverSignalConfig(env: NodeJS.ProcessEnv = process.env): DriverSignalConfig {
  return {
    adapter: parseAdapterKind(env.DRIVER_SIGNAL_ADAPTER),
    entranceUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_ENTRANCE', env.DRIVER_SIGNAL_URL_ENTRANCE),
    exitUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_EXIT', env.DRIVER_SIGNAL_URL_EXIT),
    timeoutMs: parsePositiveInt('DRIVER_SIGNAL_TIMEOUT_MS', env.DRIVER_SIGNAL_TIMEOUT_MS, 3000),
    hikvisionEntrance: loadHikvisionCamera('DRIVER_SIGNAL_HIKVISION_ENTRANCE', env),
    hikvisionExit: loadHikvisionCamera('DRIVER_SIGNAL_HIKVISION_EXIT', env),
    hikvisionPulseMs: parsePositiveInt('DRIVER_SIGNAL_HIKVISION_PULSE_MS', env.DRIVER_SIGNAL_HIKVISION_PULSE_MS, 1000),
  };
}
