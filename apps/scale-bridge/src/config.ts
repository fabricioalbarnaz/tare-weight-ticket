function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: "${value}" is not a positive integer`);
  }
  return parsed;
}

function parseRequiredString(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export interface BridgeConfig {
  /** Windows COM port name the Isis New indicator is connected to, e.g. "COM3". */
  comPort: string;
  baudRate: number;
  /** TCP port core-service's ScaleClient connects to for the raw DGN byte relay. */
  relayPort: number;
  /** HTTP port for the /health route. */
  healthPort: number;
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    comPort: parseRequiredString('SCALE_BRIDGE_COM_PORT', env.SCALE_BRIDGE_COM_PORT),
    baudRate: parsePositiveInt('SCALE_BRIDGE_BAUD_RATE', env.SCALE_BRIDGE_BAUD_RATE, 9600),
    relayPort: parsePositiveInt('SCALE_BRIDGE_RELAY_PORT', env.SCALE_BRIDGE_RELAY_PORT, 9000),
    healthPort: parsePositiveInt('SCALE_BRIDGE_HEALTH_PORT', env.SCALE_BRIDGE_HEALTH_PORT, 4100),
  };
}
