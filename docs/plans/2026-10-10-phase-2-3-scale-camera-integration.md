# Phase 2 + 3 — Scale integration & Camera integration

Status: **In progress**
Created: 2026-10-10

Per the user's instruction for this session: both phases are implemented
back-to-back without pausing for review between steps. Pause only happens
at the end of Phase 3, before any commit/PR (the user handles commits/PRs
themselves).

Per master plan §7.2/§7.3: neither the Digi-Tron Isis New protocol manual
nor the real camera model/payload format is available yet. Both phases
therefore build pluggable adapters (frame parser / payload normalizer)
backed by mocks, so the stability-wait logic, webhook wiring, and session
integration can be built and tested now, and the real parser/adapter can
be swapped in later without touching business logic.

## Phase 2 — Scale integration

- [x] Step 1: `src/scale/types.ts` —
      `ParsedWeightFrame`, `ScaleFrameParser`, `ScaleReadResult`,
      `ScaleClient` interfaces.
- [x] Step 2: `src/scale/placeholder-frame-parser.ts` — placeholder ASCII
      line parser (`ST|US,<weightKg>`), explicitly documented as NOT the
      real Isis New protocol. Unit tests covering stable/unstable frames,
      buffering partial frames across chunks, and malformed lines.
- [x] Step 3: `src/scale/tcp-client.ts` — TCP client over `net`, connects
      lazily, waits for the next stable frame within a bounded timeout,
      resolves `{ weightKg: null, weightCaptureFailed: true }` on timeout
      or connection failure (matches master plan §5 "scale read timeout"
      rule). `close()` tears the connection down.
- [x] Step 4: `src/scale/mock-scale-server.ts` — in-process TCP server
      test utility that lets tests script what frames the "indicator"
      sends and when.
- [x] Step 5: `src/scale/tcp-client.test.ts` — integration tests against
      the mock server: stable on first frame, stable after several
      unstable frames, timeout (never stabilizes), connection refused.
- [x] Step 6: scale connection config from env vars
      (`SCALE_HOST`/`SCALE_PORT`/`SCALE_STABILITY_TIMEOUT_MS`/
      `SCALE_CONNECT_TIMEOUT_MS`), added to `.env.example`.

## Phase 3 — Camera integration

- [x] Step 7: `src/camera/payload-schema.ts` — generic Fastify/JSON schema
      for the webhook body, explicitly documented as a placeholder pending
      the real camera model (master plan §7.3).
- [x] Step 8: `src/camera/normalize.ts` — normalizes the generic payload
      into `{ rawPlate, cameraId, timestamp }`, isolated so a vendor-specific
      payload shape can replace it later without touching routes/session
      logic. Unit tests.
- [x] Step 9: `src/camera/routes.ts` — `POST /webhooks/camera/entrance` and
      `POST /webhooks/camera/exit`, each: validate → normalize → read a
      stable weight from the `ScaleClient` → call
      `sessionService.handleEntranceReading`/`handleExitReading` → respond
      200 with the outcome kind + ticket id (business-level outcomes like
      `plate_unreadable`/`anomaly_flagged` are not HTTP errors).
- [x] Step 10: refactor `buildApp` to take `{ db, scaleClient }` so routes
      can be wired with a real or test repo/session-service/scale-client;
      update `server.ts` to build the real `Db` and `ScaleClient` from env
      for production use. Also added `DB_PATH` env var and a docker-compose
      data volume, since `server.ts` now actually opens a real db on boot.
- [x] Step 11: `src/camera/routes.test.ts` — end-to-end integration tests
      driving the Fastify app with a real temp-file SQLite db and a fake
      `ScaleClient`: entrance opens a ticket, retrigger overwrites, exit
      closes with net weight, exit-without-entrance flags an anomaly,
      unreadable plate on either leg logs a raw event only, scale timeout
      on either leg sets the capture-failed flag.
- [x] Step 12: update `app.test.ts` for the new `buildApp` signature.
- [x] Step 13: docs — update master plan status line + §11 implementation
      notes for Phase 2/3 decisions, update `CLAUDE.md` project status.
- [x] Step 14: `npm run lint`, `npm run typecheck`,
      `npm run test` (61 tests at the time, now 67 after the PR review
      fixes below, all passing — note: the default `forks`
      vitest pool is extremely slow to spawn workers in this sandboxed dev
      environment specifically, `--pool=threads` runs the same suite in
      ~1.5s; this looks like a sandbox/antivirus artifact, not a code
      issue, and was left as-is in `vitest.config.ts`), `npm run build` all
      green from repo root; `docker build -f docker/Dockerfile.core-service .`
      running to confirm the container still builds.

## PR review fixes (before merge)

- [x] Serialize `ScaleClient.readStableWeight()` reads (internal promise
      queue in `tcp-client.ts`) — two concurrent entrance/exit webhooks
      sharing one scale client could otherwise both resolve from the same
      incoming stable frame.
- [x] `loadScaleConfig` now throws on a malformed `SCALE_*` env var
      (non-integer, zero/negative, or empty string) instead of silently
      coercing to `0`/`NaN` via `Number()`.
- [x] TCP client: re-attach a no-op `'error'` listener during `teardown()`
      (after `removeAllListeners()`, before `destroy()`) to avoid an
      uncaught-exception crash; enabled `setKeepAlive` so a silent
      half-open disconnect gets detected/reconnected instead of hanging
      every future read forever; tear the connection down on a stability
      timeout so a late frame can't answer a later, unrelated read.
- [x] Added tests for all of the above (`config.test.ts`,
      `tcp-client.test.ts`) and hardened `mock-scale-server.ts` with a
      `connectionCount`/`waitForConnection(atLeast)` API plus an `'error'`
      listener on server-side sockets, needed to test the reconnect fix
      deterministically. 67 tests total, all green; lint/typecheck/build
      re-verified.

Delete this plan file once this work is merged (per `CLAUDE.md`).
