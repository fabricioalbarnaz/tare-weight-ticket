import fs from 'node:fs/promises';
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
