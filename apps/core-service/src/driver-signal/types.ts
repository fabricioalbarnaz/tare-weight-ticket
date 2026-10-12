export type DriverSignalDirection = 'in' | 'out';

export interface DriverSignalAdapter {
  /** Tells the driver they can move on. Must never reject — a hardware/network hiccup here must not block ticket processing. */
  signalDriver(direction: DriverSignalDirection): Promise<void>;
}
