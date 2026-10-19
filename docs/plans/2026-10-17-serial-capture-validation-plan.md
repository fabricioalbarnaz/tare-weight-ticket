# Isis New serial capture validation

## Scope

Validate live RS-232 acquisition on COM3 without changing application code,
indicator settings, or sending application commands. Use 9600 8N1, DTR enabled,
RTS disabled, and no flow control. Keep diagnostic captures in `.generated/`.

## Evidence so far

- Numeric payloads matched the operator's display at 59080, 59060, 48460, and zero kg.
- A 90-second .NET capture was regular after an opening burst; three immediate
  reopens were clean. Reopening after 60 seconds reproduced malformed bytes.
- Prefix meanings remain hypotheses. `F000000.` accompanied an empty scale.
- Opening bursts are not fresh samples; neither their source nor a production
  freshness rule has been established.

## Steps

1. **Done (2026-10-17):** Compare an independent native Windows reader with the .NET
   collector. Capture an initial opening and a reopening after a 60-second idle
   interval. Preserve raw bytes, monotonic receive times, effective settings,
   receive-queue sizes, and native communication error flags. Report evidence
   and limitations for user review before any subsequent implementation.
2. **Done (2026-10-17):** Repeat the same native-reader sequence after the user moves
   the adapter to another physical USB port. COM3 remains the assigned port.
   Compare initial opening and reopening after 60 seconds with step 1.
3. **Done (2026-10-17):** Consolidate driver installation, indicator settings,
   reader configuration, captured evidence, hypotheses, and deferred validations
   in `docs/runbooks/isis-new-serial-setup.md`. Link it from the README and update
   the master plan's scale evidence without changing application code.
4. **Pending review:** Choose the next targeted diagnostic based on the result;
   confirm DGN status semantics and freshness requirements before integrating.

## Step 1 results

- Diagnostic reader: `.generated/scale-diagnostics/native_capture.py`, using
  Python ctypes and synchronous Win32 calls, independent of .NET SerialPort.
- Evidence: `.generated/scale-captures/native-test-20261017-104709/` contains
  raw bytes, timestamped chunks, effective configuration, queue/error snapshots,
  summaries, and `analysis.json`.
- Both openings reproduced the burst: 18,169 bytes in the first second initially;
  69,287 bytes in the first second after 60 seconds with the handle closed.
- The reader confirmed 9600 8N1, DTR enabled, RTS disabled, no flow control.
  `PurgeComm` completed, and `ClearCommError` reported an empty receive queue
  immediately afterward. Native error masks remained zero during both captures.
- After the first second, the initial capture contained 17 valid frames and the
  post-idle capture contained 37, with maximum frame gaps of about 0.52 seconds.
  Live values changed; the last complete frame was `D058940.`. The operator
  subsequently confirmed that the display showed 58940 kg.
- The burst also contained syntactically valid repeated frames. Rejecting malformed
  frames alone cannot establish freshness. Excluding one second here is an analysis
  convention, not a validated production rule.
- This reproduces the symptom outside .NET and rules out an exclusively .NET
  explanation. It does not identify whether the driver, adapter, physical link,
  indicator, or setup sequence is responsible.
- Next candidate: keep DTR enabled while testing a longer closed interval, or
  compare a known-good adapter/USB port with otherwise identical settings. Obtain
  user review before selecting the next step; application code remains unchanged.

## Native API references

- https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-dcb
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-commtimeouts

## Step 2 results

- The user moved the same adapter to another physical USB port. Windows retained
  COM3. The unchanged native reader produced evidence under
  `.generated/scale-captures/native-test-20261017-105058/`.
- The first 10-second capture was clean: 19 complete `F000000.` frames plus the
  first byte of the next frame (172 bytes). A partial tail at the capture boundary
  is expected and is not a malformed complete message.
- After 60 seconds closed, the burst returned: 81,495 bytes in the first second,
  including malformed bytes and repeated syntactically valid messages.
- After that first second, 37 complete `F000000.` frames arrived with a maximum
  inter-frame gap of about 0.52 seconds. No native communication error was reported.
- Changing physical USB ports did not eliminate the symptom. The clean first
  opening cannot distinguish a port effect from the effect of reconnecting USB.
- The latest frames indicate a numeric value of zero; the operator has not yet
  confirmed the display during this specific test.
- Next candidate: compare a known-good USB-RS232 adapter, if available. Otherwise,
  investigate the close/open control-line sequence and driver buffering without
  treating a fixed startup delay as a verified solution.

## Additional live capture (2026-10-17, 10:53)

- At the user's report of another truck entering, captured 40 seconds with the
  native reader. Evidence: `.generated/scale-captures/truck-entry-20261017-105335/`.
- Capture began with the numeric value already near 21900; it does not cover the
  complete approach from an empty platform.
- After the opening burst: `@021900.` then `D021900.`, followed by `@021920.`
  and 71 consecutive `D021920.` frames over approximately 36 seconds.
- The operator confirmed a stable display of 21920 kg. Maximum frame gap after
  the first second was 0.535 seconds. No native communication errors were reported.
- The same numeric weight appearing with `@` and `D` supports a status distinction;
  the exact flag semantics remain unconfirmed by the vendor.
- The opening still contained a malformed sequence (1548 bytes before CR).

## Operational constraints

No calibration changes, zero/tare commands, indicator restart, driver replacement,
ticket creation, or production parser changes are included.
