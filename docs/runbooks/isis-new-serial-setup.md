# DIGI-TRON Isis New serial setup and field findings

Field session: **2026-10-17**, Windows PC, local time America/Sao_Paulo.

This guide records how we established live weight acquisition from a DIGI-TRON
Isis New through a USB-RS-232 adapter. Use it to reproduce the setup on another
PC and to continue validation. Numeric readings matched the indicator, and
continuous reception worked with DTR enabled. An unresolved burst on opening
means that a well-formed message alone is not sufficient to accept a live weight.

**Implemented as a provisional first version (2026-10-20)**, per
`docs/plans/2026-10-20-isis-new-scale-integration-plan.md`: a real
`dgn-frame-parser.ts` in `core-service` and a native `apps/scale-bridge`
process that owns the physical COM port and relays it to `core-service`
over TCP (mirroring `apps/print-bridge`'s native, outside-Docker
placement). The state-byte semantics and the stability/burst-guard rule
below are implemented exactly as documented here, as explicit **provisional
assumptions** — this is not a vendor-confirmed DGN spec or a production
sign-off. The on-site validation checklist near the end of this document
(cold boot, PC reboot, known-good adapter comparison, DIGI-TRON's own DGN
spec) is still open. No indicator calibration, zero, tare, filter, or
firmware changes were made during the diagnostics that produced the
evidence below. Readers sent no application commands to the indicator.

## Equipment and source documents

The indicator was connected by its serial cable to a USB adapter on this PC.
Windows identified the adapter with:

```text
USB\VID_0403&PID_6001&REV_0600
USB\VID_0403&PID_6001
```

These IDs are supported by the FTDI driver family; they do not by themselves
prove the adapter's exact model or electrical implementation. Use a USB-RS-232
adapter, not a USB-TTL interface. Cable pinout and adapter model remain to be
recorded. The exact physical indicator port used, COM1 or COM2, was not recorded;
the operator confirmed that both had the same menu settings.

Reference material supplied for the session:

- `MANUAL_USUARIO_ISIS_NEW_23092026161902674.pdf`, in the operator's Downloads
  folder. Its printed identification is Revision 01, Firmware 01, 2025-09-04.
  This is the manual's identification, not a verified firmware version from the
  installed indicator. Relevant pages: 20–21 (transmission modes), 26 (serial
  configuration), 31–32 (stored-ticket export), 33–34 (communications).
- `Abordagens para leitura do peso — DIGI-TRON Isis New.md`, also in Downloads.
- [FTDI VCP drivers](https://ftdichip.com/drivers/vcp-drivers/) and
  [FTDI Windows installation guide](https://ftdichip.com/wp-content/uploads/2023/11/AN_396_FTDI_Drivers_Installation_Guide_for_Windows_10_11.pdf).

Keep copies of the supplied documents with the installation handover. Their
original local paths are not portable to another PC.

## Windows driver setup

1. Connect the USB adapter and open Device Manager.
2. If there is no serial port, inspect **Other devices**. Initially this PC
   showed **USB Serial Converter** with a yellow warning. The General tab said
   drivers were not installed, **Code 28**; automatic discovery returned no COM
   ports either.
3. Open Properties, select **Details → Hardware Ids**, and record the IDs above.
   Identify each new adapter from its own IDs rather than assuming it is FTDI.
4. For this FTDI adapter, obtain the VCP driver for the PC's Windows version and
   architecture from the official FTDI page. VCP exposes a standard COM port.
   The installation guidance used was to run the available setup executable,
   complete installation, then disconnect and reconnect USB.
5. Verify the result in Device Manager: **USB Serial Converter** appeared under
   USB controllers without a warning, and **USB Serial Port (COM3)** appeared
   under **Ports (COM & LPT)** without a warning.
6. Record the assigned COM number. **COM3 belongs to this installation**; another
   PC or adapter may receive a different number.

The exact driver package version and Windows build were not recorded. Capture
them from the Driver tab and Windows system information on the next visit.
Installing LibreOffice or Python was not part of the driver fix.

To list ports from Windows PowerShell:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

This enumerates ports; it does not verify communication with the indicator.

## Why continuous serial acquisition was selected

In continuous mode, the indicator pushes readings; the PC does not need to send
a weight request for each sample. The proposed five-second checkpoints belong
to application-side evaluation, not a documented DGN polling command.

The manual's Manual mode sends after the operator presses the print key while
stable. Automatic mode sends once after stabilization and requires a return to
zero before the next cycle. Stored-ticket CSV/XML/JSON export is a separate
menu-driven operation, not a live weight interface. Gravity SLP/SCP were discussed
in the supplied approaches analysis but were neither installed nor tested here.
Optional Ethernet/Wi-Fi do not establish a documented live TCP or REST protocol
for this installation. Direct serial capture was the interface actually tested.

## Indicator and reader settings

The operator inspected both ports under **MENU → INTERFACES**. The physical
indicator's fields differed from the supplied manual. Preserve the actual values:

| Protocol screen field | Value reported on both ports |
| --- | --- |
| Protocol | `DGN` |
| Function | `Simples` |
| Label | `protocolo serial` |
| Mode | `continuo` (continuous) |

| Communication parameter | Confirmed working reader setting |
| --- | --- |
| Baud rate | 9600 bps |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| Flow control | None |
| DTR | Enabled |
| RTS | Disabled; enabling it also received data in a short comparison |

The indicator explicitly showed 9600 bps, one stop bit, and no parity. Eight
data bits began as a test hypothesis because the manual does not specify them;
**9600 8N1 produced readable, display-matching frames in repeated tests**.
Do not replace 9600 with the manual's factory default of 4800 without checking
the installed equipment.

No indicator menu values were changed during this session. In particular, a
gross/net selection and a date/time output setting were not identified on this
unit. Do not reinterpret its Function or Label fields as those settings. Confirm
the weight basis before using it for ticket calculations.

The indicator's COM1/COM2 names are independent of Windows COM3. If another
program is already using the Windows port, close it before opening a reader.

## Reproducing a diagnostic capture

Use 9600 8N1, no handshake, DTR enabled, and RTS disabled in whichever reader
is selected. Merely installing the driver or setting baud rate is insufficient:
the application must configure the control lines too.

After the USB-port change, one newly opened native handle initially reported
1200 bps, seven data bits, and even parity before the collector applied 9600 8N1.
This was a PC-side state observation, not an indicator setting change or an
identified cause of the burst. No Device Manager baud/parity edits were made;
always configure and verify the reader's effective settings explicitly.

The following Windows PowerShell example follows the diagnostic configuration.
Change `COM3` to the port assigned on the new PC. It logs received chunks for
20 seconds and closes the port in `finally`. It is a raw capture example, not a
production parser or a guarantee that the captured bytes are fresh.

```powershell
$ErrorActionPreference = 'Stop'
$serial = New-Object System.IO.Ports.SerialPort 'COM3',9600,
  ([System.IO.Ports.Parity]::None),8,([System.IO.Ports.StopBits]::One)
$serial.Handshake = [System.IO.Ports.Handshake]::None
$serial.DtrEnable = $true
$serial.RtsEnable = $false
$serial.ReadTimeout = 300
$capturePath = Join-Path (Get-Location) ('scale-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
$log = $null
try {
  $log = New-Object System.IO.StreamWriter $capturePath,$false
  $serial.Open()
  $serial.DiscardInBuffer()
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt 20) {
    $buffer = New-Object byte[] 256
    try {
      $count = $serial.Read($buffer,0,$buffer.Length)
      $record = [pscustomobject]@{
        timestamp = [DateTimeOffset]::Now.ToString('o')
        seconds = $clock.Elapsed.TotalSeconds
        hex = [BitConverter]::ToString($buffer,0,$count)
      }
      $log.WriteLine(($record | ConvertTo-Json -Compress))
    } catch [System.TimeoutException] {
      # A 300 ms wait can expire between normal 520 ms transmissions.
    }
  }
} finally {
  if ($serial.IsOpen) { $serial.Close() }
  $serial.Dispose()
  if ($null -ne $log) { $log.Dispose() }
}
Write-Output $capturePath
```

Keep the operator's display reading and observation time alongside each capture.
Partial chunks are normal: one read often contained only the first byte and the
next read contained the remaining eight bytes. Combine chunks before looking for
complete frames. Do not treat a short read as a complete weight or an error.

Some early exploratory collectors hung and retained the port until their
processes were stopped. USB disconnect/reconnect was also used to recover the
connection. Bounded reads and reliable handle cleanup were used in later tests.
An access-denied error on opening can indicate an occupied port; do not terminate
unrelated processes or repeatedly open competing readers.

## Observed wire format and display comparisons

Regular positive whole-kilogram readings used this observed shape:

```text
D059080.<CR>
44 30 35 39 30 38 30 2E 0D
```

There are eight content bytes plus carriage return `0x0D`: a leading state byte,
six numeric characters, and a decimal point. In these captures, `059080.` matched
59080 kg on the display. No fractional digits were transmitted in the regular
frames captured here. Other resolutions, negative signs, errors, and optional
fields require separate validation. The placeholder `ST,<weight>` format in
the application is not this protocol.

| Operator-confirmed display | Matching serial content |
| --- | --- |
| 59080 kg | `D059080.` |
| 59060 kg | `D059060.` |
| 48460 kg | `D048460.` |
| 58940 kg | `D058940.` |
| 21920 kg | `D021920.` |
| 0 kg throughout a stationary empty-platform test | `F000000.` |

Regular frames arrived approximately every **0.52 seconds**. The latest
40-second capture included `@021900.` → `D021900.` → `@021920.` → `D021920.`,
then 71 consecutive `D021920.` frames over about 36 seconds. The operator
confirmed 21920 kg. This capture started near 21900 kg and did not cover the
entire approach from zero.

An earlier transition capture contained falling weights, `B000000.`, rising
weights, and a sustained `D046560.` sequence. The 46560 kg value was not directly
confirmed by the operator at capture time; it should not be listed as an
independently verified display match.

### State byte hypotheses

| Byte | Observation | Interpretation still to validate |
| --- | --- | --- |
| `@` (`0x40`) | Appeared during changing weights and before `D` at the same number | Motion or not stable |
| `D` (`0x44`) | Accompanied sustained, operator-confirmed weights | Stable |
| `B` (`0x42`) | Seen during a transition through numeric zero | A zero-related state |
| `F` (`0x46`) | Repeated throughout a confirmed empty-platform test | Possibly zero and stable combined |
| `H` (`0x48`) | A frame `H000020.` occurred near a transition through zero | Unknown; do not assume positive 20 kg |

The byte values suggest flags may be combined, but this is an inference, not a
vendor-confirmed bit map. Do not hard-code these hypotheses as established
metrological semantics. The same numeric weight arrived under both `@` and `D`,
so identical consecutive numbers alone do not establish indicator stability.

## Tests performed and unresolved opening burst

1. Initial 9600 8N1 captures with DTR/RTS disabled received a few matching
   59080 kg frames, then stopped; a subsequent 20-second capture received none.
2. Three six-second control-line tests received no bytes with both lines off,
   11 matching frames with only DTR on, and 11 with DTR and RTS on. The working
   baseline became DTR on, RTS off. This establishes a useful configuration for
   this connection, not a universal DGN requirement.
   DSR became active with DTR, and CTS became active with RTS; these observations
   do not establish the cable pinout or whether signals are looped locally.
3. A clean ten-second capture received 20 complete 59060 kg messages.
4. A 90-second capture, after its initial burst, received 172 valid zero frames
   without interruptions. Three immediate reopens each received 19 complete
   frames over ten seconds and no burst.
5. Closing for 60 seconds and reopening reproduced an approximately 8.9 KB
   malformed opening sequence, followed by 28 valid zero frames.
6. A Python ctypes reader using native Win32 calls reproduced the problem
   independently of .NET `SerialPort`. After a 60-second closed interval,
   69,287 bytes arrived in the first second, followed by regular traffic.
7. Moving the same adapter to another physical USB port retained COM3. The
   initial capture was clean; reopening after 60 seconds produced 81,495 bytes
   in the first second. Changing USB ports therefore did not eliminate it.
8. The final truck capture still began with malformed data, then regularly
   matched the operator-confirmed 21920 kg.

The anomalous volume in some opening bursts exceeds what could be newly
transmitted at 9600 bps in that interval. Bursts included non-ASCII bytes,
missing carriage returns, and thousands of repeated **syntactically valid**
frames. In one native capture, `D059040.` occurred 7330 times across the capture,
mostly in the opening burst, before regular readings eventually reached 58940 kg.

Both collectors discarded the input buffer after opening. The native reader
also confirmed effective communication settings and an empty driver receive
queue immediately after `PurgeComm`; the burst still followed. Native error
masks and later .NET error-event logs reported no errors, despite the malformed
data. Absence of an error flag is not proof of valid data.

The cause remains unresolved: driver, adapter, physical link, indicator behavior,
and setup/control-line sequencing are still candidates. No second adapter was
tested. A clean first capture after USB reconnection does not isolate a physical
port effect from the effect of reconnecting the adapter.

Analyses excluded the first second to compare subsequent regular traffic.
**A fixed one-second discard is not a validated production solution.** Format
validation alone cannot reject valid-looking old or repeated messages.

## Direction for EixoLink development

Serial DGN continuous acquisition was the **field-tested integration direction**
for this installation, and is now implemented as a provisional first version.
How each requirement below was addressed:

- **Serial transport behind the existing `ScaleClient` abstraction**: done via
  `apps/scale-bridge` (native, outside Docker) relaying the COM port over TCP;
  `core-service`'s `SCALE_HOST`/`SCALE_PORT` point at the bridge, and
  `apps/core-service/src/scale/dgn-frame-parser.ts` replaces the placeholder
  parser. Nothing else in `tcp-client.ts` changed.
- **Continuous reception, serialized requests**: unchanged — `ScaleClient`
  already kept one persistent connection open across reads; `scale-bridge`
  keeps the COM port open for the life of the process the same way, so the
  opening burst is only ever encountered at bridge start/reconnect, not per
  truck.
- **Fresh, complete data only**: addressed by the stability rule below, not
  by a separate freshness check — see its rationale.
- **Stability semantics and observation window**: implemented as `D`/`F` =
  candidate-stable, `@` = explicitly unstable, **any other/unrecognized byte
  = not-stable (fail-safe)** — never guessed at. The "five-second window" idea
  was replaced by: a weight counts only once 3 consecutive matching candidate
  readings have been seen, each spaced >= 2000ms apart (both configurable via
  `SCALE_STABILITY_READING_COUNT`/`SCALE_STABILITY_SAMPLE_INTERVAL_MS`). This
  single rule also doubles as the burst guard: every capture in this document
  measured the anomalous volume as concentrated within the first ~1 second
  after opening, so a 2000ms minimum spacing between *counted* readings means
  thousands of rapid, syntactically-valid repeated frames (e.g. `D059040.` ×
  7330 in one capture) can never satisfy 3 counted matches that fast — only
  readings genuinely separated in time after the burst subsides can. This is
  still a documented assumption, not a guarantee: only idle intervals up to
  60 seconds were tested; cold boot and PC reboot remain open below.
- **Malformed/unsupported states rejected, pending data invalidated on
  reconnect**: the parser discards any byte sequence not matching the
  observed 8-byte shape and resyncs on the next frame delimiter rather than
  throwing or desyncing permanently; a fresh connection starts its stability
  streak from zero.
- **Preserve the indicator's value as-is**: no averaging, rounding, or unit
  conversion was added. Gross/net semantics are still unconfirmed — see below.

Treat all of the above as explicit provisional assumptions, not production
acceptance for unattended ticket issuance, until the open items in the next
section are resolved.

## Validation to resume on site

- [ ] Record Windows build, driver version, adapter make/model, cable wiring,
  physical indicator COM port, firmware, scale division, and gross/net basis.
- [ ] Obtain the complete DGN frame and status-bit specification from DIGI-TRON,
  including sign, zero, motion, stability, overload, errors, units, and resolution.
- [ ] Compare a known-good USB-RS-232 adapter with the same setup. If unavailable,
  investigate driver buffering and DTR transitions without assuming the cause.
- [ ] Repeat long closed intervals, USB unplug/replug, process restart, and PC
  reboot; verify cleanup and freshness after every recovery.
- [ ] Capture complete empty → entry → stable → departure → empty cycles,
  correlating timestamps and status indications with the operator's display.
- [ ] Validate a bounded startup/freshness policy against valid-looking bursts;
  define acceptable receive cadence and detect gaps, replay, and stale data.
- [ ] Validate malformed, fragmented, oversized, negative, overload, and stopped
  streams; confirm they cannot produce accepted weights accidentally.
- [ ] Tune and document the stability window, permitted variation in scale
  divisions, timeout, and zero handling. Zero is valid telemetry but is not
  automatically a valid truck weighing.
- [ ] Decide the Windows/Docker transport boundary and verify the complete
  camera → fresh stable weight → ticket → print workflow before deployment acceptance.

## Evidence archive and handover

Local artifacts are under `.generated/scale-captures/`:

| Artifact name | Purpose |
| --- | --- |
| `20261017-102906.json` and `.bin` | Truck transition capture |
| `20261017-103227.json` | Display-matching 48460 kg capture |
| `connection-test-20261017-103559/` | 90 seconds continuous and three immediate reopens |
| `idle-test-20261017-104124/` | .NET reopening after a 60-second idle interval |
| `native-test-20261017-104709/` | Independent native reader and idle comparison |
| `native-test-20261017-105058/` | Same sequence after moving USB ports |
| `truck-entry-20261017-105335/` | 40-second capture and confirmed 21920 kg |

The native collector is `.generated/scale-diagnostics/native_capture.py`. It
uses Python's standard library and Windows APIs, hard-codes COM3, and runs a
10-second capture, a 60-second closed interval, then a 20-second capture. The
Python executable available on this PC happened to be bundled with LibreOffice;
another PC can use a suitable installed Windows Python. This is not an EixoLink
runtime dependency.

The `.generated/` artifacts are local, uncommitted diagnostics at the time of
writing. Archive the captures, collector, source manual, and adapter/driver
details with the deployment handover; do not assume a fresh checkout includes
them. Early exploratory console-only captures have no equivalent saved archive.

The active [validation plan](../plans/2026-10-17-serial-capture-validation-plan.md)
tracks remaining diagnostic work; the
[integration plan](../plans/2026-10-20-isis-new-scale-integration-plan.md)
tracks the implementation summarized above. Native collector references:
[DCB settings](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-dcb)
and [serial timeouts](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-commtimeouts).
