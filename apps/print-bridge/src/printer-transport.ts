import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface PrinterTransport {
  print(bytes: Buffer): Promise<void>;
}

export interface FilePrinterTransportOptions {
  outputDir: string;
}

/**
 * Placeholder transport: writes each print job to a file instead of a
 * real USB printer. No printer hardware is available yet and the
 * `usbipd-win` vs. native-process spike (master plan §7 risk #1) hasn't
 * happened, so this lets the HTTP plumbing and ESC/POS formatting be
 * built and tested now. Swap for a real USB transport once that's
 * resolved — the `PrinterTransport` interface is the seam.
 */
export function createFilePrinterTransport(options: FilePrinterTransportOptions): PrinterTransport {
  return {
    async print(bytes) {
      await fs.mkdir(options.outputDir, { recursive: true });
      const filePath = path.join(options.outputDir, `${Date.now()}-${randomUUID()}.bin`);
      await fs.writeFile(filePath, bytes);
    },
  };
}

export interface NetworkPrinterTransportOptions {
  host: string;
  port: number;
  /** Bounded wait for the TCP connection itself before treating the print as failed. */
  connectTimeoutMs?: number;
}

/**
 * Sends raw ESC/POS bytes over TCP to a network-attached thermal printer's
 * "RAW"/JetDirect port (conventionally 9100) — confirmed on-site
 * (2026-10-24) against the installed POS80 network printer, bypassing the
 * Windows print spooler entirely. A new connection is opened per print job
 * since tickets print infrequently (one per truck); there is no need to
 * keep a persistent socket open the way the scale client does.
 */
export function createNetworkPrinterTransport(options: NetworkPrinterTransportOptions): PrinterTransport {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;

  return {
    print(bytes) {
      return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let settled = false;

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          reject(err);
        };

        socket.setTimeout(connectTimeoutMs);
        socket.once('timeout', () => fail(new Error('printer connection timed out')));
        socket.once('error', fail);

        socket.connect(options.port, options.host, () => {
          socket.setTimeout(0);
          socket.write(bytes, (err) => {
            if (err) {
              fail(err);
              return;
            }
            socket.end();
          });
        });

        socket.once('close', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
      });
    },
  };
}
