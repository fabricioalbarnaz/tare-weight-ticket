# Camera integration — real Hikvision ANPR payload adjustments

Status: **Steps 1–6 implemented, build/typecheck/lint/tests/docker build all
green. Awaiting user review and PR/merge; Step 7 (wrap-up) happens after
that.**
Created: 2026-10-15

Implements the adjustments identified in the master plan
(`docs/plans/2026-09-29-tare-weight-ticket-plan.md` §7 item 3) now that the
real camera payload format is confirmed. Replaces the generic
`{ plate, cameraId, timestamp }` JSON placeholder (built in Phase 3 before
any real camera info existed) with the real Hikvision ISAPI
`multipart/form-data` + `anpr.xml` shape. Scale integration (§7.2) is
unaffected and stays on its placeholder.

## Design decisions made for this plan (flag if any should change)

- **JPEGs are drained and discarded, not stored.** No object storage exists
  in this stack today, and nothing in the ticket flow needs the images.
  Revisit only if the user wants image retention later.
- **The `anpr.xml` part is located by its multipart field name** (literally
  `"anpr.xml"`, confirmed by the Rails capture using `params["anpr.xml"]`),
  not by the `Content-ID` header the three JPEG parts use. Since the JPEGs
  are discarded anyway, we never need to distinguish them by anything other
  than "not the anpr.xml field" — avoids needing to parse `Content-ID`
  headers out of busboy parts at all in this pass.
- **Canonical plate field is `ANPR > licensePlate`** (agrees with
  `originalLicensePlate` and `PlateInfoList > PlateInfo > licensePlate` in
  every real capture seen so far).
- **`cameraId` now comes from the payload's `deviceID`** instead of being
  caller-supplied. Entrance vs. exit is still decided by which webhook URL
  received the POST (unchanged design) — `deviceID` is stored only for
  display/audit, same role `cameraId` already played.
- **Read-quality threshold** (new logic — nothing like this exists today):
  a plate read is accepted only if `confidenceLevel >= 80` **and** the
  normalized plate is exactly 7 characters (both Brazilian plate formats —
  legacy `AAA9999` and Mercosul `AAA9A99` — are 7 chars; the
  truck-load-queue findings show a 5-character high-per-character-
  confidence read that was almost certainly a truncated 7-character plate).
  Anything failing either check is treated as `plate_unreadable` (existing
  code path — just needs to reach it with an empty `rawPlate`), not guessed
  at. Both numbers are arbitrary starting points, called out here
  explicitly so they're easy to tune once there's real field data.
- **No change to `session-service.ts` or the audit/raw-event shape.** The
  isolation boundary (`payload-schema`/`normalize` only) that Phase 2–3
  deliberately built for this exact swap holds — confirmed by re-reading
  `session-service.ts`, which only ever consumes the already-normalized
  `{ rawPlate, cameraId, timestamp, weightKg, weightCaptureFailed }` shape.

## Steps

### Step 1 — Dependencies
Status: Done. Added `@fastify/multipart` and `fast-xml-parser` to
`apps/core-service/package.json`; lockfile regenerated via the Alpine
Docker one-liner.

Add `@fastify/multipart` (multipart parsing) and `fast-xml-parser` (XML →
object) to `apps/core-service/package.json`. Regenerate the lockfile via
the Alpine Docker one-liner in `CLAUDE.md` (no local Python/node-gyp
toolchain on this machine) — neither package has a native dependency, but
the lockfile still needs regenerating consistently that way.

### Step 2 — XML parsing layer
Status: Done. `anpr-xml.ts` + tests against the two real captures added.
One adjustment made while implementing: `parseAnprXml` only throws when
`deviceID`/`dateTime` are missing — a missing/empty `licensePlate` or
`confidenceLevel` defaults instead of throwing, since an unreadable plate
is an expected business outcome (`plate_unreadable`), not a malformed
request. The original "throws on XML missing licensePlate" test was wrong
under that corrected understanding and was replaced.

New `apps/core-service/src/camera/anpr-xml.ts`:
- `AnprXmlEvent` interface: `deviceId`, `dateTime` (string), `licensePlate`,
  `confidenceLevel` (number), `plateCharBelieve` (parsed `number[]`),
  `direction`, `country` — only the fields this system can plausibly use;
  explicitly not modeling the AI-cabin/driver-feature or bounding-box
  fields from the real payload.
- `parseAnprXml(xml: string): AnprXmlEvent`, built on `fast-xml-parser`,
  reading from `EventNotificationAlert.ANPR` (falling back to
  `EventNotificationAlert.deviceID` at the root for `deviceId`, since that
  field lives outside `<ANPR>`).
- Unit tests using the two real anonymized captures from
  `C:\Users\fabri\Documents\Sites\truck-load-queue\docs\anpr-event-payload-findings.md`
  §2–3 as fixtures (inlined as literal XML strings in the test file — no
  need to read that other repo at runtime).

### Step 3 — Read-quality check
Status: Done. `isReliablePlateRead` implemented in `normalize.ts` with the
≥80 confidence / exactly-7-characters rule, unit tested with boundary
cases.

A small `isReliablePlateRead(plate: string, confidenceLevel: number):
boolean` (co-located with `normalize.ts`, since it's part of turning the
raw read into something the session service can trust) implementing the
≥80 confidence + exactly-7-characters rule from the design decisions above.
Unit tested directly with boundary cases (79 vs 80, 6 vs 7 vs 8 chars).

### Step 4 — `normalize.ts` rewrite
Status: Done, as designed.

`normalizeCameraPayload(event: AnprXmlEvent): NormalizedCameraEvent`:
- `cameraId` ← `event.deviceId`.
- `timestamp` ← `new Date(event.dateTime)`, falling back to `new Date()` if
  that doesn't parse (mirrors today's "timestamp optional" fallback).
- `rawPlate` ← `event.licensePlate` normalized via the existing
  `normalizePlate`, blanked back out to `''` if `isReliablePlateRead`
  rejects it — reuses the existing `plate_unreadable` path in
  `session-service.ts` without that file changing.
Update `normalize.test.ts` for the new input/threshold behavior (replacing
the now-inapplicable `plate`/`cameraId`/`timestamp` JSON-shaped cases).

### Step 5 — `routes.ts` rewrite
Status: Done. `@fastify/multipart` registered in `app.ts` (10 MB
`fileSize` limit). `payload-schema.ts` deleted; nothing else imported it.

- Register `@fastify/multipart` on the app (likely in `app.ts` alongside
  the other plugin registrations, with a generous `limits.fileSize` — e.g.
  10 MB — so draining a real JPEG part never errors).
- Replace the `schema: { body: cameraWebhookPayloadSchema }` JSON-schema
  validation with manual multipart handling in both handlers: iterate
  `request.parts()`, `await part.toBuffer()` on every part (draining the
  two non-`anpr.xml` parts and discarding the result), parse the
  `anpr.xml` part's buffer with `parseAnprXml`.
- `reply.code(400)` when the `anpr.xml` part is missing entirely or
  `deviceID`/`licensePlate` can't be extracted from it (malformed request —
  same class of failure the current "missing `cameraId`" 400 test covers).
- Delete `payload-schema.ts` (superseded by `anpr-xml.ts` + the inline
  validation above) once nothing imports it.

### Step 6 — Tests
Status: Done. The native `FormData`/`Response` approach worked as planned
for building real multipart bodies without a test-only dependency. Caught
two real bugs while writing these against the Step 2/5 code (fixed, not
just test-only issues):
- Several carried-over test plates (`LOAD0001`, `TIME0001`, `EXITFAIL`,
  `NOENTRY1`) were 8 characters, not 7 — tripped the new length check for
  reasons unrelated to what those tests were checking. Renamed to 7-char
  equivalents.
- Confirmed via Step 2's fix: a plate-less event must reach
  `plate_unreadable` (HTTP 200), not 400.

Full verification run (all in the `node:24-alpine` container per
`CLAUDE.md`, since local `npm`/native builds don't work on this machine):
`npm run build`/`typecheck`/`lint` and `vitest run` for `@tare/core-service`
all green (178 tests), repo-wide `npm run lint` clean (pre-existing
unrelated warnings in `admin-ui` only), and `docker build -f
docker/Dockerfile.core-service` succeeds.

Rewrite `routes.test.ts`'s `postEntrance`/`postExit` helpers to send real
`multipart/form-data` bodies instead of JSON. Build the multipart body with
Node's built-in `FormData`/`Blob`/`Response` (`new Response(formData)` lets
undici serialize proper multipart bytes and hand back the matching
`Content-Type` boundary header) — avoids adding a multipart-building
dependency just for tests. Each test's `anpr.xml` part is a literal XML
string built from a small helper that fills in `licensePlate`/
`confidenceLevel`/`deviceID` so existing test cases (retrigger, capture-
failed, anomaly, unreadable, missing-field 400) carry over with minimal
rewriting. Add one case proving a stray JPEG-like extra part doesn't break
the request (drained and ignored).

### Step 7 — Wrap-up (after the user reviews/merges)
Status: Not started.

- Update master plan §7 item 3: mark the "required adjustments" list as
  done, same pattern as prior phases' §11 lessons-learned entries.
- Delete this plan file per `CLAUDE.md`'s workflow once merged.
