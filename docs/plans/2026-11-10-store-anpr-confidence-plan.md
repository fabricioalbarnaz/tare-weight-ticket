# Store ANPR read confidence with every camera reading

Status: **Step 1 done — awaiting go-ahead for step 2 (production deploy).**
Created: 2026-11-10

## Context

The Hikvision `anpr.xml` push carries `confidenceLevel` (overall, 0–100)
and `plateCharBelieve` (comma-separated per-character confidence).
`camera/anpr-xml.ts` already parses both, but they're only used once —
`isReliablePlateRead` in `camera/normalize.ts` (confidence ≥ 80 and exactly
7 characters, otherwise the plate becomes `''` / unreadable) — and then
dropped. `raw_events` only keeps `rawPlate`/`plate`/`cameraId`/`timestamp`,
and request bodies aren't logged, so a misread can't be analyzed after the
fact.

Trigger (2026-11-10): the entrance camera read **GGG8319** for truck
**IGG8319** (ticket #560 opened under the wrong plate; its exit became
ANOMALY #562). The same I→G misread happened on 2026-10-27 (#121). There
was no way to tell how confident the camera was in that "G". The user asked
to keep this information for future analysis — including calibrating the
`MIN_CONFIDENCE_LEVEL = 80` threshold, which is still an unvalidated
starting value (master plan §7 item 3).

## Decision

- `NormalizedCameraEvent` gains the camera's read-quality fields, carried
  through `EntranceReadingInput`/`ExitReadingInput` and spread into
  **every** `camera_entrance`/`camera_exit` `raw_events` payload — normal
  reads, unreadable reads, and the route-level discards (post-release
  debounce, scale-read preemption):
  - `readPlate` — what the camera actually read (normalized), **before**
    the reliability filter. Today an unreadable read stores `rawPlate: ''`
    and loses what the camera thought it saw.
  - `confidenceLevel` — overall confidence (number).
  - `plateCharBelieve` — per-character confidence (number array, as parsed).
- Flat keys in the existing JSON payload, so they're queryable with
  SQLite `json_extract(raw_payload, '$.confidenceLevel')`. No schema or
  migration change; existing rows simply lack the keys.
- Not added: ticket columns or Admin UI display (not requested — this is
  for offline analysis). Non-ANPR pushes (`diskerror`, `illaccess`) carry
  no plate read and are unchanged.

## Steps

1. **Code + tests + docs** — `normalize.ts`, `session-service.ts` (one
   helper building the camera raw-event payload, used by all 8 call
   sites), `routes.ts` (pass through; debounce/preempted payloads). Tests:
   normalize and routes assert the fields land in `raw_events`, including
   for an unreadable read and both route-level discards. Master plan §11
   note. (Docs folded into this step so only the deploy waits on review.)
   Status: **done** (2026-11-10 — Alpine: camera + tickets suites 116/116,
   core-service typecheck/lint clean)
2. **Production deploy** — backup procedure, rebuild, confirm the next
   real reading's `raw_events` row carries the new fields.
   Status: pending — awaiting user go-ahead
