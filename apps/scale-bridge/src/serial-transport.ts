import { SerialPort } from 'serialport';
import { noopLogger, type BridgeLogger } from './logger.js';

/**
 * Pluggable seam over the physical COM port, so the relay/health logic can
 * be tested with a fake source instead of real hardware (same pattern as
 * print-bridge's `PrinterTransport`).
 */
export interface SerialTransport {
  onData(listener: (chunk: Buffer) => void): void;
  isOpen(): boolean;
  close(): Promise<void>;
}

export interface SerialPortTransportOptions {
  path: string;
  baudRate: number;
  /** Defaults to a no-op logger (used by tests/call sites that don't care about log output). */
  logger?: BridgeLogger;
}

/**
 * Real transport: opens the physical COM port with the settings confirmed
 * against the live indicator in the field session (see
 * docs/runbooks/isis-new-serial-setup.md) — 9600 8N1, no flow control, DTR
 * enabled, RTS disabled. Kept open for the life of the process (persistent
 * connection), matching core-service's `ScaleClient` design and confining
 * the still-unresolved opening-burst behavior to process start/reconnect.
 */
export function createSerialPortTransport(options: SerialPortTransportOptions): SerialTransport {
  const logger = options.logger ?? noopLogger;
  const port = new SerialPort({
    path: options.path,
    baudRate: options.baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    rtscts: false,
    autoOpen: false,
  });

  port.open((err) => {
    if (err) {
      logger.error({ comPort: options.path, err: err.message }, 'scale-bridge: failed to open serial port');
      return;
    }
    logger.info({ comPort: options.path, baudRate: options.baudRate }, 'scale-bridge: serial port open');
    port.set({ dtr: true, rts: false }, (setErr) => {
      if (setErr) {
        logger.error({ comPort: options.path, err: setErr.message }, 'scale-bridge: failed to set DTR/RTS control lines');
      }
    });
  });

  port.on('error', (err) => {
    logger.error({ comPort: options.path, err: err.message }, 'scale-bridge: serial port error');
  });

  return {
    onData(listener) {
      port.on('data', listener);
    },
    isOpen() {
      return port.isOpen;
    },
    close() {
      return new Promise((resolve) => {
        if (!port.isOpen) {
          resolve();
          return;
        }
        port.close(() => {
          logger.info({ comPort: options.path }, 'scale-bridge: serial port closed');
          resolve();
        });
      });
    },
  };
}
