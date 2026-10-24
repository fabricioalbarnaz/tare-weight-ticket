import { buildApp } from './app.js';
import { createFilePrinterTransport, createNetworkPrinterTransport, type PrinterTransport } from './printer-transport.js';

const port = Number(process.env.PRINT_BRIDGE_PORT ?? 4000);

function createTransport(): PrinterTransport {
  const kind = process.env.PRINTER_TRANSPORT ?? 'file';

  if (kind === 'network') {
    const host = process.env.PRINTER_NETWORK_HOST;
    const networkPort = Number(process.env.PRINTER_NETWORK_PORT ?? 9100);
    if (!host) throw new Error('PRINTER_NETWORK_HOST is required when PRINTER_TRANSPORT=network');
    return createNetworkPrinterTransport({
      host,
      port: networkPort,
      connectTimeoutMs: Number(process.env.PRINTER_CONNECT_TIMEOUT_MS ?? 5000),
    });
  }

  if (kind !== 'file') throw new Error(`Unknown PRINTER_TRANSPORT "${kind}" (expected "file" or "network")`);
  const outputDir = process.env.PRINT_BRIDGE_OUTPUT_DIR ?? './print-jobs';
  return createFilePrinterTransport({ outputDir });
}

const app = buildApp({ transport: createTransport() });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
