# Phase 0 — Scaffolding

Status: complete, awaiting user review
Parent plan: `docs/plans/2026-09-29-tare-weight-ticket-plan.md` (§9, Phase 0)

## Goal

Stand up the empty project skeleton so every later phase has somewhere to
land: git repo, npm workspaces monorepo, TypeScript/ESLint/Prettier config,
a minimal Fastify `core-service` with a health check, Docker/Compose
skeleton, and CI. No business logic yet.

## Steps

1. [x] `git init`, `.gitignore` (node_modules, dist, .env, etc.), `.nvmrc`
   pinning Node 22 (available locally via nvm even though the shell default
   is v14). **Revised:** switched to Node 24 — as of Oct 2025, Node 22 is
   Maintenance LTS (security fixes only, EOL Apr 2027) while Node 24 is
   Active LTS (EOL Apr 2028), so it's the right pin for a new project.
   Updated `.nvmrc`, root `package.json` `engines`, `docker/Dockerfile.core-service`
   base image, and `@types/node` in `apps/core-service`. Node 24 isn't
   installed locally yet (nvm has it available but installing needs disk
   space) — re-run local verification (step 10) under Node 24 once
   installed.
2. [x] Root `package.json` as an npm workspaces root (`apps/*`,
   `packages/*`), with root scripts: `lint`, `typecheck`, `test`, `build`,
   `format`.
3. [x] Shared TS config (`tsconfig.base.json`, strict mode), ESLint flat
   config, Prettier config — applied at the root, extended by each
   workspace package. Also added a project-level `.npmrc` pinning the
   public npm registry (a personal `~/.npmrc` on the dev machine was
   pointing installs at a corporate Artifactory proxy, which baked
   unusable authenticated URLs into `package-lock.json`).
4. [x] `packages/shared`: empty stub TS package (package.json + tsconfig +
   `src/index.ts`) so the workspace wiring is proven before Phase 1 starts
   putting real shared types in it.
5. [x] `apps/core-service`: Fastify app factory (`src/app.ts`) + bootstrap
   (`src/server.ts`) + a `GET /health` route returning `{ status: "ok" }`.
   Vitest set up with one test hitting `/health` via Fastify's `inject()`.
6. [x] `docker/Dockerfile.core-service` (multi-stage: build then slim
   runtime) and `docker/docker-compose.yml` (core-service only for now,
   restart policy set, port exposed via env).
7. [x] `.env.example` at root (just `PORT` for now — more vars land as
   later phases add hardware config).
8. [x] `.github/workflows/ci.yml`: install → lint → typecheck → test →
   docker build, on push and PR.
9. [x] Minimal root `README.md`: what the project is (one paragraph) and
   pointers to `CLAUDE.md` and `docs/plans/`.
10. [x] Verify locally: install, lint, typecheck, test, and docker build
    all pass before calling this phase done.
    - [x] Node 24 installed via nvm; `npm install`, `npm run lint`,
      `npm run typecheck`, `npm run test`, `npm run build` all pass clean
      from the repo root under Node 24.
    - [x] `docker build -f docker/Dockerfile.core-service .` succeeds
      against `node:24-alpine`. (Along the way, a Docker Desktop restart
      was needed — the earlier disk-full event had left its build-cache
      storage read-only; a restart plus `docker builder prune` /
      `docker image prune` cleared it.)
    - [x] Ran the built image (`docker run -p 3000:3000 core-service:local`)
      and confirmed `GET /health` returns `{"status":"ok"}` from inside the
      container, not just from `npm run dev`.

**Phase 0 complete.** All steps done; verified end to end including the
containerized run. Per workflow, pausing here for review — say "continue"
to move on to Phase 1 (domain core: SQLite schema + Drizzle migrations,
ticket session state machine, business rules from the master plan §5).

## Explicitly not in this phase

- `apps/admin-ui` and `apps/print-bridge` — scaffolded in Phase 6 and
  Phase 5 respectively, when there's real code to put in them.
- Any actual scale/camera/printer/relay integration or business logic
  (Phase 1+).
