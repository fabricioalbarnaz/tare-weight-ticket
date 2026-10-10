# EixoLink

EixoLink is the product name; the repository and packages keep the technical
name `tare-weight-ticket` / `@tare/*`.

Fully automatic truck weighbridge ("tare weight") system. One installation
runs independently per physical scale/PC: an entrance camera and an exit
camera identify trucks by plate, a Digi-Tron Isis New indicator provides the
weight, and a ticket is printed automatically once both an entry and exit
weight are recorded.

See `CLAUDE.md` for architecture/workflow guidance and `docs/plans/` for the
full development plan and any in-progress feature plans.

## Development

Requires Node 24 (see `.nvmrc`).

```
npm install
npm run lint
npm run typecheck
npm run test
```

### Admin UI

`apps/admin-ui` is a standalone React/Vite SPA. By default it runs against
an in-memory mock of the admin API (via MSW), so it's fully usable before
the real backend routes exist:

```
npm run dev --workspace=@tare/admin-ui
```

Sign in with `admin` / `admin123` (the mock credentials). Set
`VITE_API_MODE=proxy` (see `apps/admin-ui/.env.example`) to instead proxy
`/api` to a real `core-service` running on `localhost:3000`.

## Docker

```
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up
```
