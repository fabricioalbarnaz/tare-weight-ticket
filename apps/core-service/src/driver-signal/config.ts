import { parseOptionalUrl, parsePositiveInt } from '../config/env.js';

export type DriverSignalAdapterKind = 'http-relay' | 'hikvision-isapi';

export type BarrierGateCtrlMode = 'open' | 'close' | 'lock' | 'unlock';

export interface HikvisionIsapiCameraConfig {
  baseUrl: string;
  channelId: string;
  ctrlMode: BarrierGateCtrlMode;
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
}

function parseAdapterKind(value: string | undefined): DriverSignalAdapterKind {
  if (!value || value === 'http-relay') return 'http-relay';
  if (value === 'hikvision-isapi') return 'hikvision-isapi';
  throw new Error(`Invalid DRIVER_SIGNAL_ADAPTER: "${value}" (expected "http-relay" or "hikvision-isapi")`);
}

function parseCtrlMode(varName: string, value: string | undefined): BarrierGateCtrlMode {
  if (!value || value === 'open') return 'open';
  if (value === 'close' || value === 'lock' || value === 'unlock') return value;
  throw new Error(`Invalid ${varName}: "${value}" (expected "open", "close", "lock", or "unlock")`);
}

// Each camera is configured as a group (URL + relay channel + credentials);
// an unset URL disables that direction (same convention as the http-relay
// adapter's entranceUrl/exitUrl), but a set URL with a missing sibling
// field is a misconfiguration, not a partially-disabled direction.
//
// channelId/ctrlMode target PUT /ISAPI/Parking/channels/<channelId>/barrierGate
// — confirmed live (2026-11-04) to be the endpoint that actually operates the
// camera's relay, unlike the generic IO/outputs trigger this used to call.
// Which ctrlMode ("open" = relay 1, "close" = relay 2) drives the siren is
// still unconfirmed on-site — see docs/runbooks/hikvision-tcg406-relay-findings.md.
function loadHikvisionCamera(prefix: string, env: NodeJS.ProcessEnv): HikvisionIsapiCameraConfig | undefined {
  const urlVar = `${prefix}_URL`;
  const baseUrl = parseOptionalUrl(urlVar, env[urlVar]);
  if (!baseUrl) return undefined;

  const username = env[`${prefix}_USERNAME`];
  if (!username) throw new Error(`Missing required env var ${prefix}_USERNAME (required when ${urlVar} is set)`);

  const password = env[`${prefix}_PASSWORD`];
  if (!password) throw new Error(`Missing required env var ${prefix}_PASSWORD (required when ${urlVar} is set)`);

  return {
    baseUrl,
    channelId: env[`${prefix}_CHANNEL_ID`] || '1',
    ctrlMode: parseCtrlMode(`${prefix}_CTRL_MODE`, env[`${prefix}_CTRL_MODE`]),
    username,
    password,
  };
}

export function loadDriverSignalConfig(env: NodeJS.ProcessEnv = process.env): DriverSignalConfig {
  return {
    adapter: parseAdapterKind(env.DRIVER_SIGNAL_ADAPTER),
    entranceUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_ENTRANCE', env.DRIVER_SIGNAL_URL_ENTRANCE),
    exitUrl: parseOptionalUrl('DRIVER_SIGNAL_URL_EXIT', env.DRIVER_SIGNAL_URL_EXIT),
    timeoutMs: parsePositiveInt('DRIVER_SIGNAL_TIMEOUT_MS', env.DRIVER_SIGNAL_TIMEOUT_MS, 3000),
    hikvisionEntrance: loadHikvisionCamera('DRIVER_SIGNAL_HIKVISION_ENTRANCE', env),
    hikvisionExit: loadHikvisionCamera('DRIVER_SIGNAL_HIKVISION_EXIT', env),
  };
}
