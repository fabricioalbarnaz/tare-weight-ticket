import { buildApp } from './app.js';
import { createFilePrinterTransport } from './printer-transport.js';

const port = Number(process.env.PRINT_BRIDGE_PORT ?? 4000);
const outputDir = process.env.PRINT_BRIDGE_OUTPUT_DIR ?? './print-jobs';

const transport = createFilePrinterTransport({ outputDir });
const app = buildApp({ transport });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
