export type DriverSignalDirection = 'in' | 'out';

export interface DriverSignalStatus {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}

export interface DriverSignalAdapter {
  /** Tells the driver they can move on. Must never reject — a hardware/network hiccup here must not block ticket processing. */
  signalDriver(direction: DriverSignalDirection): Promise<void>;
  /** Outcome of the most recent signal attempts, for the Admin UI's hardware status panel. */
  getStatus(): DriverSignalStatus;
}
