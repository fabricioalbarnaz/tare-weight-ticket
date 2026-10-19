export interface ParsedWeightFrame {
  weightKg: number;
  stable: boolean;
}

export interface ScaleFrameParser {
  /**
   * Feeds newly received bytes and returns any complete frames parsed so
   * far. Implementations buffer partial frames internally across calls.
   */
  push(chunk: Buffer): ParsedWeightFrame[];
}

export interface ScaleReadResult {
  weightKg: number | null;
  weightCaptureFailed: boolean;
}

export interface ScaleStatus {
  connected: boolean;
  lastSeenAt: Date | null;
}

export interface ScaleClient {
  /** Waits for the indicator's next stable weight, bounded by a timeout. */
  readStableWeight(): Promise<ScaleReadResult>;
  /** Current TCP connection state, for the Admin UI's hardware status panel. */
  getStatus(): ScaleStatus;
  close(): void;
}
