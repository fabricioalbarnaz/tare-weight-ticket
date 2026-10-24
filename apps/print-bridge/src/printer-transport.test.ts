import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createFilePrinterTransport, createNetworkPrinterTransport } from './printer-transport.js';

let outputDir: string;

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe('createFilePrinterTransport', () => {
  it('writes the exact bytes it was given to a new file in the output dir', async () => {
    outputDir = path.join(os.tmpdir(), `tare-print-bridge-test-${randomUUID()}`);
    const transport = createFilePrinterTransport({ outputDir });
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x42]);

    await transport.print(bytes);

    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);
    const written = await fs.readFile(path.join(outputDir, files[0]!));
    expect(written).toEqual(bytes);
  });

  it('creates the output directory if it does not exist yet', async () => {
    outputDir = path.join(os.tmpdir(), `tare-print-bridge-test-${randomUUID()}`, 'nested');
    const transport = createFilePrinterTransport({ outputDir });

    await transport.print(Buffer.from('hello'));

    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(1);
  });

  it('writes a separate file per print call', async () => {
    outputDir = path.join(os.tmpdir(), `tare-print-bridge-test-${randomUUID()}`);
    const transport = createFilePrinterTransport({ outputDir });

    await transport.print(Buffer.from('a'));
    await transport.print(Buffer.from('b'));

    const files = await fs.readdir(outputDir);
    expect(files).toHaveLength(2);
  });
});

describe('createNetworkPrinterTransport', () => {
  it('sends the exact bytes to a real TCP listener', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const transport = createNetworkPrinterTransport({ host: '127.0.0.1', port });
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x42]);
    await transport.print(bytes);

    expect(Buffer.concat(received)).toEqual(bytes);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects when nothing is listening on the target port', async () => {
    const transport = createNetworkPrinterTransport({ host: '127.0.0.1', port: 1, connectTimeoutMs: 1000 });

    await expect(transport.print(Buffer.from('x'))).rejects.toThrow();
  });
});
