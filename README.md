# EixoLink

EixoLink is the product name; the repository and packages keep the technical
name `tare-weight-ticket` / `@tare/*`.

Fully automatic truck weighbridge ("tare weight") system. One installation
runs independently per physical scale/PC: an entrance camera and an exit
camera identify trucks by plate, a Digi-Tron Isis New indicator provides the
weight, and a ticket is printed automatically once both an entry and exit
weight are recorded.

This repository is the base/engineering project for **EixoLink**, the
product name the Admin UI is branded with (see the Admin UI section below).
The repo, package names, and docs keep the original "Tare Weight Ticket"
working title; only the user-facing Admin UI uses the product name.

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

The UI is translated (`react-i18next`, see `src/i18n/`) and defaults to
Portuguese (pt-BR), the language of this system's actual operators; English
is also available via the language switcher in the header/login page. The
in-app language choice is remembered per browser (`localStorage`) and
independently also drives date/number formatting.

## Docker

```
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up
```
