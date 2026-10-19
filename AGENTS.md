# Repository Guidelines

## Project Structure & Module Organization

EixoLink is a per-scale truck weighbridge system using Node 24 and npm workspaces; retain the technical `@tare/*` package names.

- `apps/core-service/src/`: Fastify, Drizzle/SQLite, ticket logic, and hardware integrations; migrations live in `apps/core-service/drizzle/`.
- `apps/admin-ui/src/`: React/Vite UI, API mocks, and pt-BR/en translations; static assets live in `public/`.
- `apps/print-bridge/src/`: ESC/POS generation and printer transport, running natively outside Docker.
- `packages/shared/src/`: shared TypeScript contracts.
- `docker/`: deployment configuration; `docs/plans/`: architecture and working plans.

## Build, Test, and Development Commands

Use Node 24 (`.nvmrc`). Install dependencies with `npm ci` in a supported environment.

- `npm run lint`: run ESLint.
- `npm run build`: build workspaces, shared package first.
- `npm run typecheck`: check workspace TypeScript types.
- `npm test`: run workspace Vitest suites.
- `npm run format`: apply Prettier repository-wide; review the diff.
- `npm run dev --workspace=@tare/admin-ui`: start Vite with MSW mocks by default.
- `npm run dev --workspace=@tare/core-service`: start the backend watcher.
- `docker compose -f docker/docker-compose.yml up --build`: build and run the container stack.

On this Windows development machine, follow `CLAUDE.md`'s disposable Linux-container verification workflow: native `better-sqlite3` installation requires Python, make, and g++.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, single quotes, trailing commas, and Prettier's 100-column width. Follow ESLint and React Hooks rules. Use PascalCase for React component files and kebab-case for backend modules. Keep hardware adapters separate from ticket business logic.

## Testing Guidelines

Colocate Vitest tests as `*.test.ts` or `*.test.tsx`. UI tests use Testing Library, jsdom, and MSW. Database tests use real temporary SQLite files. Cover normal flows, anomalies, retries, and failures; no numeric coverage threshold is configured. Playwright is configured via `npm run test:e2e --workspace=@tare/admin-ui`; add specs under `e2e/` when needed. Match CI's lint, build, typecheck, tests, and Docker-image checks.

## Commit & Pull Request Guidelines

Recent commits use `feat(core-service): ...` and `feat(admin-ui): ...`; older history uses imperative summaries. Describe behavior changes, validation, related issues/plans, and UI screenshots when relevant. The user creates commits and PRs; agents provide suggested messages and descriptions.

## Agent Workflow

Read `CLAUDE.md` and the master plan before implementation. For nontrivial code changes, maintain a stepwise plan in `docs/plans/`, complete one step, then wait for explicit review before continuing. Preserve deferred hardware boundaries and the single-scale scope.
