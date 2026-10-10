export interface ScaleConfig {
  host: string;
  port: number;
  stabilityTimeoutMs: number;
  connectTimeoutMs: number;
}

export function loadScaleConfig(env: NodeJS.ProcessEnv = process.env): ScaleConfig {
  return {
    host: env.SCALE_HOST ?? '127.0.0.1',
    port: Number(env.SCALE_PORT ?? 9000),
    stabilityTimeoutMs: Number(env.SCALE_STABILITY_TIMEOUT_MS ?? 15000),
    connectTimeoutMs: Number(env.SCALE_CONNECT_TIMEOUT_MS ?? 5000),
  };
}
