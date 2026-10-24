# Network printer transport for print-bridge

Status: **All 4 steps done, verified on-site. Not yet committed — pending user review.**
Created: 2026-10-24

## Context

The master plan assumed the thermal printer would be USB-attached and left
an open risk/decision between `usbipd-win` passthrough and a native
fallback (master plan §7 item 1). On the first definitive production PC
(on-site, 2026-10-24), the installed printer turned out to be a **network**
thermal printer instead: Windows shows it as `POS80 Ticket` (driver
`POS80ENG`) on port `192.168.29.25`, and a raw TCP connection to
`192.168.29.25:9100` (the standard "RAW"/JetDirect port for ESC/POS
printers) accepted real ESC/POS bytes built by `buildTicketEscPos` and
printed them physically. This resolves the USB-vs-native-fallback decision
without needing either — neither `usbipd-win` nor a native USB library is
needed for this install. A real printer cut-margin bug was found and fixed
along the way: `cutPaper()` was only preceded by 2 blank line feeds, which
on the installed POS80 cut through the last line of printed text; fixed by
feeding 5 blank lines before cutting (`escpos.ts`), confirmed fixed by a
physical reprint on-site.

`apps/print-bridge`'s `PrinterTransport` interface
(`printer-transport.ts`) was built exactly as the seam for this: only a
file-writing placeholder existed before this plan.

## Scope

Add a real network `PrinterTransport`, selectable via env var so the file
transport stays available for local dev/tests, wire it into this PC's
`print-bridge` Windows service, and verify a real ticket prints through the
**full** system path (`core-service` → `print-bridge` → printer), not just
a direct bypass test.

Out of scope: a USB transport (moot now — this install's printer is
network-attached; keep the interface seam in case another PC's printer
differs), retry/backoff policy beyond what `PrintService`/`PrintClient`
already do.

## Steps

1. **`createNetworkPrinterTransport` in `printer-transport.ts`.**
   - Opens a new TCP connection per print job to `host:port`, writes the
     bytes, waits for the OS to accept them, then ends the connection
     cleanly; rejects the returned promise on connect error/timeout so
     `print-bridge`'s `/print` handler's existing try/catch reports a
     failure back to `core-service` (which already has the single-print
     guarantee / manual reprint flow for exactly this case).
   - Tests: spin up a real local `net.Server` (same "no mocking" pattern
     already used for the file transport / DB tests) and assert it
     receives the exact bytes; assert the promise rejects if nothing is
     listening on the target port.
   Status: done.

2. **Wire transport selection into `server.ts` via env vars.**
   - `PRINTER_TRANSPORT` (`file` default, or `network`), plus
     `PRINTER_NETWORK_HOST`, `PRINTER_NETWORK_PORT`,
     `PRINTER_CONNECT_TIMEOUT_MS` for the network case.
   - Update `.env.example` documenting these (print-bridge reads
     `process.env` directly, no `.env` loader — same as its existing vars;
     documented there because `docs/runbooks/per-pc-deployment.md`'s NSSM
     `-EnvVar` list is sourced from it).
   Status: done.

3. **Point this PC's `print-bridge` service at the real printer and verify end-to-end.**
   - Update the `EixoLinkPrintBridge` NSSM service's environment
     (`PRINTER_TRANSPORT=network`, `PRINTER_NETWORK_HOST=192.168.29.25`,
     `PRINTER_NETWORK_PORT=9100`), restart it.
   - Run a real ticket through `core-service` (not a direct bypass socket
     test) and confirm it physically prints via the operator.
   Status: done — confirmed physically printed, complete, by the operator.

4. **Docs.**
   - `docs/runbooks/per-pc-deployment.md`: printer is a per-PC hardware
     placeholder like the COM port — document the new env vars and that
     the printer may be network-attached (check `Get-Printer` / the
     printer's own admin page for its IP) rather than assuming USB.
   - Note the resolved USB-vs-native decision and the cut-margin fix in
     the master plan's §11 (implementation notes).
   Status: done.

## Out of scope for this plan

- A USB `PrinterTransport` implementation.
- Choosing driver-signal relay hardware or camera IP configuration (tracked
  separately, still open per the per-pc-deployment runbook).
