# Tare Weight Ticket

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

## Docker

```
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up
```
